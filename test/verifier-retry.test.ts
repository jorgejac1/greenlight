/**
 * Tests for LLM verifier retry behavior (v3.1).
 *
 * - On 429 / 503, the verifier retries once (MAX_RETRIES=1)
 * - On second success after initial 429/503, result reflects the successful response
 * - After exhausting retries, the result includes a descriptive error
 * - Non-retryable status codes (400, 401, 500) are not retried
 */

import assert from "node:assert/strict";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import type { Contract } from "../src/types.js";
import { runContract } from "../src/verifier.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLlmContract(
	prompt: string,
	provider: "anthropic" | "openai" | "ollama",
	baseUrl: string,
): Contract {
	return {
		id: "retry-test",
		title: "Retry test contract",
		checked: false,
		status: "pending",
		line: 0,
		rawLines: [0],
		verifier: {
			kind: "llm",
			prompt,
			provider,
			baseUrl,
		},
	};
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

function startMockServer(handler: RequestHandler): Promise<{ server: Server; baseUrl: string }> {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			req.on("end", () => handler(req, res, body));
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (typeof address === "object" && address !== null) {
				resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
			}
		});
	});
}

function stopServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Tests: retry on 429
// ---------------------------------------------------------------------------

describe("LLM verifier retry — 429 Too Many Requests", () => {
	it("succeeds on retry after initial 429 (ollama)", async () => {
		let callCount = 0;

		const { server, baseUrl } = await startMockServer((_req, res, _body) => {
			callCount++;
			if (callCount === 1) {
				res.writeHead(429, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "rate limited" }));
			} else {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						message: { role: "assistant", content: "PASS" },
						done: true,
					}),
				);
			}
		});

		try {
			const contract = makeLlmContract("Does the output look correct?", "ollama", baseUrl);
			const result = await runContract(contract, "/tmp");

			assert.equal(callCount, 2, "should have made exactly 2 requests (initial + 1 retry)");
			assert.equal(result.passed, true, `expected pass after retry, stderr: ${result.stderr}`);
		} finally {
			await stopServer(server);
		}
	});

	it("fails after exhausting retries on 429 (ollama) — returns last API error", async () => {
		let callCount = 0;
		const { server, baseUrl } = await startMockServer((_req, res, _body) => {
			callCount++;
			res.writeHead(429, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "rate limited" }));
		});

		try {
			const contract = makeLlmContract("Does the output look correct?", "ollama", baseUrl);
			const result = await runContract(contract, "/tmp");

			// Two calls: initial + 1 retry
			assert.equal(callCount, 2, "should attempt exactly 2 calls");
			assert.equal(result.passed, false);
			// On exhaustion, the last response's parsed error is surfaced
			assert.ok(result.stderr.length > 0, "stderr should contain an error message");
		} finally {
			await stopServer(server);
		}
	});
});

// ---------------------------------------------------------------------------
// Tests: retry on 503
// ---------------------------------------------------------------------------

describe("LLM verifier retry — 503 Service Unavailable", () => {
	it("succeeds on retry after initial 503 (ollama)", async () => {
		let callCount = 0;

		const { server, baseUrl } = await startMockServer((_req, res, _body) => {
			callCount++;
			if (callCount === 1) {
				res.writeHead(503, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "service unavailable" }));
			} else {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						message: { role: "assistant", content: "FAIL" },
						done: true,
					}),
				);
			}
		});

		try {
			const contract = makeLlmContract("Does the code pass?", "ollama", baseUrl);
			const result = await runContract(contract, "/tmp");

			assert.equal(callCount, 2, "should retry exactly once on 503");
			// Second response says FAIL, so result.passed = false but it ran successfully
			assert.equal(result.passed, false);
			assert.equal(result.exitCode, 1);
		} finally {
			await stopServer(server);
		}
	});

	it("fails after exhausting retries on 503 (openai-compatible) — returns last API error", async () => {
		let callCount = 0;
		const { server, baseUrl } = await startMockServer((_req, res, _body) => {
			callCount++;
			res.writeHead(503, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: { message: "service unavailable" } }));
		});

		const savedKey = process.env.OPENAI_API_KEY;
		try {
			process.env.OPENAI_API_KEY = "test-key";
			const contract = makeLlmContract("Does the code pass?", "openai", baseUrl);
			const result = await runContract(contract, "/tmp");

			assert.equal(callCount, 2, "should attempt exactly 2 calls");
			assert.equal(result.passed, false);
			assert.ok(result.stderr.length > 0, "stderr should contain an error message");
		} finally {
			if (savedKey !== undefined) {
				process.env.OPENAI_API_KEY = savedKey;
			} else {
				delete process.env.OPENAI_API_KEY;
			}
			await stopServer(server);
		}
	});
});

// ---------------------------------------------------------------------------
// Tests: non-retryable status codes
// ---------------------------------------------------------------------------

describe("LLM verifier retry — non-retryable status codes", () => {
	it("does not retry on 400 (ollama)", async () => {
		let callCount = 0;

		const { server, baseUrl } = await startMockServer((_req, res, _body) => {
			callCount++;
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "bad request" }));
		});

		try {
			const contract = makeLlmContract("Does the code pass?", "ollama", baseUrl);
			const result = await runContract(contract, "/tmp");

			assert.equal(callCount, 1, "should NOT retry on 400");
			assert.equal(result.passed, false);
		} finally {
			await stopServer(server);
		}
	});

	it("does not retry on 500 (ollama)", async () => {
		let callCount = 0;

		const { server, baseUrl } = await startMockServer((_req, res, _body) => {
			callCount++;
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "internal server error" }));
		});

		try {
			const contract = makeLlmContract("Does the code pass?", "ollama", baseUrl);
			const result = await runContract(contract, "/tmp");

			assert.equal(callCount, 1, "should NOT retry on 500");
			assert.equal(result.passed, false);
		} finally {
			await stopServer(server);
		}
	});
});
