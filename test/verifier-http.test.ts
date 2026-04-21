/**
 * Tests for the eval.http verifier added in v2.2.
 *
 * Spins up a tiny node:http server inline per test — no external dependencies.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { Contract, HttpVerifier } from "../src/types.js";
import { runContract } from "../src/verifier.js";

function makeContract(verifier: HttpVerifier): Contract {
	return {
		id: "test-http",
		title: "Test HTTP verifier",
		checked: false,
		status: "pending",
		verifier,
		line: 0,
		rawLines: [0],
	};
}

/** Starts a one-shot HTTP server and returns its base URL + a stop function. */
function startServer(
	handler: (
		req: import("node:http").IncomingMessage,
		res: import("node:http").ServerResponse,
	) => void,
): Promise<{ url: string; stop: () => Promise<void> }> {
	return new Promise((resolve, reject) => {
		const server = createServer(handler);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			const url = `http://127.0.0.1:${port}`;
			const stop = (): Promise<void> =>
				new Promise((res, rej) => server.close((err) => (err ? rej(err) : res())));
			resolve({ url, stop });
		});
		server.on("error", reject);
	});
}

describe("http verifier", () => {
	it("passes when server returns expected status (default 200)", async () => {
		const { url, stop } = await startServer((_req, res) => {
			res.writeHead(200);
			res.end("OK");
		});
		try {
			const result = await runContract(makeContract({ kind: "http", url }), process.cwd());
			assert.strictEqual(result.passed, true);
			assert.strictEqual(result.exitCode, 0);
		} finally {
			await stop();
		}
	});

	it("fails when server returns unexpected status", async () => {
		const { url, stop } = await startServer((_req, res) => {
			res.writeHead(500);
			res.end("Internal Server Error");
		});
		try {
			const result = await runContract(
				makeContract({ kind: "http", url, status: 200 }),
				process.cwd(),
			);
			assert.strictEqual(result.passed, false);
			assert.ok(result.stderr.includes("500"));
		} finally {
			await stop();
		}
	});

	it("passes when body contains expected substring", async () => {
		const { url, stop } = await startServer((_req, res) => {
			res.writeHead(200);
			res.end('{"status":"healthy"}');
		});
		try {
			const result = await runContract(
				makeContract({ kind: "http", url, contains: '"status":"healthy"' }),
				process.cwd(),
			);
			assert.strictEqual(result.passed, true);
		} finally {
			await stop();
		}
	});

	it("fails when body does not contain expected substring", async () => {
		const { url, stop } = await startServer((_req, res) => {
			res.writeHead(200);
			res.end('{"status":"degraded"}');
		});
		try {
			const result = await runContract(
				makeContract({ kind: "http", url, contains: '"status":"healthy"' }),
				process.cwd(),
			);
			assert.strictEqual(result.passed, false);
			assert.ok(result.stderr.includes("does not contain"));
		} finally {
			await stop();
		}
	});

	it("sets timedOut=true when server does not respond within timeoutMs", async () => {
		// Server accepts connection but never sends a response.
		const { url, stop } = await startServer((_req, _res) => {
			// Intentionally hang — never call res.end()
		});
		try {
			const result = await runContract(
				makeContract({ kind: "http", url, timeoutMs: 150 }),
				process.cwd(),
			);
			assert.strictEqual(result.passed, false);
			assert.strictEqual(result.timedOut, true);
			assert.ok(result.durationMs < 2_000, `took too long: ${result.durationMs}ms`);
		} finally {
			await stop();
		}
	});

	it("passes with explicit status check when server returns correct code", async () => {
		const { url, stop } = await startServer((_req, res) => {
			res.writeHead(201);
			res.end("Created");
		});
		try {
			const result = await runContract(
				makeContract({ kind: "http", url, status: 201 }),
				process.cwd(),
			);
			assert.strictEqual(result.passed, true);
		} finally {
			await stop();
		}
	});
});
