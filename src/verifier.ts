import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { resolve } from "node:path";
import { appendRun } from "./log.js";
import type { Contract, DiffVerifier, RunResult, ShellVerifier, TriggerSource } from "./types.js";

interface ShellOutcome {
	stdout: string;
	stderr: string;
	exitCode: number;
	durationMs: number;
	timedOut: boolean;
}

export async function runShell(v: ShellVerifier, cwd: string): Promise<ShellOutcome> {
	const start = Date.now();
	const timeoutMs = v.timeoutMs ?? 120_000;

	return new Promise((resolve) => {
		// detached: true puts the child in its own process group so we can
		// kill the entire group (shell + its children) with process.kill(-pid).
		// Without this, SIGTERM sent to the shell on Linux orphans grandchildren.
		const child = spawn(v.command, { shell: true, cwd, detached: true });
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		child.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});

		function killGroup(signal: NodeJS.Signals): void {
			try {
				// Negative PID kills the process group (shell + all children).
				if (child.pid !== undefined) process.kill(-child.pid, signal);
			} catch {
				// Fallback in case the group is already gone.
				try {
					child.kill(signal);
				} catch {
					/* ignore */
				}
			}
		}

		let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
		const timer = setTimeout(() => {
			timedOut = true;
			killGroup("SIGTERM");
			sigkillTimer = setTimeout(() => killGroup("SIGKILL"), 2_000);
		}, timeoutMs);

		child.on("error", (err) => {
			clearTimeout(timer);
			clearTimeout(sigkillTimer);
			resolve({
				stdout,
				stderr: `${stderr}\n[spawn error] ${err.message}`,
				exitCode: -1,
				durationMs: Date.now() - start,
				timedOut: false,
			});
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			clearTimeout(sigkillTimer);
			resolve({
				stdout,
				stderr: timedOut ? `${stderr}\n[evalgate] verifier timed out after ${timeoutMs}ms` : stderr,
				exitCode: code ?? -1,
				durationMs: Date.now() - start,
				timedOut,
			});
		});
	});
}

async function runComposite(
	contract: Contract,
	cwd: string,
	mode: "all" | "any",
	steps: ShellVerifier[],
	aggregateTimeoutMs?: number,
): Promise<RunResult> {
	const start = Date.now();
	const outputs: string[] = [];
	let passed = false;
	let timedOut = false;

	for (const baseStep of steps) {
		let step = baseStep;
		// If an aggregate timeout is set, cap each remaining step to the budget left.
		if (aggregateTimeoutMs !== undefined) {
			const elapsed = Date.now() - start;
			const remaining = aggregateTimeoutMs - elapsed;
			if (remaining <= 0) {
				timedOut = true;
				outputs.push(`[aggregate timeout] exceeded ${aggregateTimeoutMs}ms`);
				passed = false;
				break;
			}
			// Clamp the per-step timeout to the remaining aggregate budget.
			step = { ...step, timeoutMs: Math.min(step.timeoutMs ?? 120_000, remaining) };
		}

		const r = await runShell(step, cwd);
		const stepPassed = r.exitCode === 0 && !r.timedOut;
		if (r.timedOut) timedOut = true;
		outputs.push(
			`[${step.command}] exit ${r.exitCode}\n` +
				(r.stdout.trim() ? r.stdout : "") +
				(r.stderr.trim() ? r.stderr : ""),
		);

		if (mode === "any" && stepPassed) {
			passed = true;
			break;
		}
		if (mode === "all" && !stepPassed) {
			passed = false;
			break;
		}
		passed = stepPassed;
	}

	return {
		contract,
		passed,
		stdout: outputs.join("\n---\n"),
		stderr: timedOut ? `[evalgate] composite verifier timed out after ${aggregateTimeoutMs}ms` : "",
		exitCode: passed ? 0 : 1,
		durationMs: Date.now() - start,
		timedOut,
	};
}

async function runLlmJudge(contract: Contract, prompt: string, model: string): Promise<RunResult> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		return {
			contract,
			passed: false,
			stdout: "",
			stderr: "ANTHROPIC_API_KEY is not set — required for eval.llm verifiers",
			exitCode: -1,
			durationMs: 0,
		};
	}

	const start = Date.now();
	const body = JSON.stringify({
		model,
		max_tokens: 64,
		messages: [
			{
				role: "user",
				content: `You are a code quality judge. Answer with exactly one word: PASS or FAIL.\n\n${prompt}`,
			},
		],
	});

	const LLM_TIMEOUT_MS = 60_000;

	return new Promise((resolve) => {
		let settled = false;
		function settle(result: RunResult): void {
			if (settled) return;
			settled = true;
			resolve(result);
		}

		const req = request(
			{
				hostname: "api.anthropic.com",
				path: "/v1/messages",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
					"Content-Length": Buffer.byteLength(body),
				},
			},
			(res) => {
				let raw = "";
				res.on("data", (d) => {
					raw += d;
				});
				res.on("end", () => {
					const durationMs = Date.now() - start;
					try {
						const json = JSON.parse(raw) as {
							content?: Array<{ text?: string }>;
							error?: { message: string };
						};
						if (json.error) {
							settle({
								contract,
								passed: false,
								stdout: "",
								stderr: json.error.message,
								exitCode: -1,
								durationMs,
							});
							return;
						}
						const text = (json.content?.[0]?.text ?? "").trim().toUpperCase();
						const passed = text.startsWith("PASS");
						settle({
							contract,
							passed,
							stdout: text,
							stderr: "",
							exitCode: passed ? 0 : 1,
							durationMs,
						});
					} catch (e) {
						settle({
							contract,
							passed: false,
							stdout: "",
							stderr: `parse error: ${e}`,
							exitCode: -1,
							durationMs: Date.now() - start,
						});
					}
				});
			},
		);

		// Hard timeout: destroy the request after 60 s.
		const timeoutTimer = setTimeout(() => {
			req.destroy();
			settle({
				contract,
				passed: false,
				stdout: "",
				stderr: `[evalgate] LLM verifier timed out after ${LLM_TIMEOUT_MS}ms`,
				exitCode: -1,
				durationMs: Date.now() - start,
				timedOut: true,
			});
		}, LLM_TIMEOUT_MS);
		if (timeoutTimer.unref) timeoutTimer.unref();

		req.on("error", (e) => {
			clearTimeout(timeoutTimer);
			settle({
				contract,
				passed: false,
				stdout: "",
				stderr: e.message,
				exitCode: -1,
				durationMs: Date.now() - start,
			});
		});
		req.write(body);
		req.end();
	});
}

function runDiff(verifier: DiffVerifier, cwd: string, contract: Contract): RunResult {
	const filePath = resolve(cwd, verifier.file);
	const start = Date.now();
	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch {
		return {
			contract,
			passed: false,
			stdout: "",
			stderr: `file not found: ${verifier.file}`,
			exitCode: 1,
			durationMs: Date.now() - start,
		};
	}
	let regex: RegExp;
	try {
		regex = new RegExp(verifier.pattern);
	} catch {
		return {
			contract,
			passed: false,
			stdout: "",
			stderr: `invalid regex pattern: ${verifier.pattern}`,
			exitCode: 1,
			durationMs: Date.now() - start,
		};
	}
	const matches = regex.test(content);
	const passed = verifier.mode === "has" ? matches : !matches;
	const stdout =
		verifier.mode === "has"
			? passed
				? `pattern found in ${verifier.file}`
				: `pattern not found in ${verifier.file}`
			: passed
				? `pattern absent from ${verifier.file}`
				: `pattern still present in ${verifier.file}`;
	return {
		contract,
		passed,
		stdout,
		stderr: "",
		exitCode: passed ? 0 : 1,
		durationMs: Date.now() - start,
	};
}

export async function runContract(
	contract: Contract,
	cwd: string,
	opts?: { todoPath?: string; trigger?: TriggerSource },
): Promise<RunResult> {
	if (!contract.verifier) {
		return {
			contract,
			passed: false,
			stdout: "",
			stderr: "no verifier defined",
			exitCode: -1,
			durationMs: 0,
		};
	}

	let result: RunResult;

	if (contract.verifier.kind === "shell") {
		const r = await runShell(contract.verifier, cwd);
		result = {
			contract,
			passed: r.exitCode === 0 && !r.timedOut,
			stdout: r.stdout,
			stderr: r.stderr,
			exitCode: r.exitCode,
			durationMs: r.durationMs,
			timedOut: r.timedOut || undefined,
		};
	} else if (contract.verifier.kind === "composite") {
		result = await runComposite(
			contract,
			cwd,
			contract.verifier.mode,
			contract.verifier.steps,
			contract.verifier.timeoutMs,
		);
	} else if (contract.verifier.kind === "llm") {
		const model = contract.verifier.model ?? "claude-haiku-4-5-20251001";
		result = await runLlmJudge(contract, contract.verifier.prompt, model);
	} else if (contract.verifier.kind === "diff") {
		result = runDiff(contract.verifier, cwd, contract);
	} else {
		result = {
			contract,
			passed: false,
			stdout: "",
			stderr: `unknown verifier kind`,
			exitCode: -1,
			durationMs: 0,
		};
	}

	if (opts?.todoPath) {
		appendRun(result, opts.todoPath, opts.trigger ?? "manual");
	}

	return result;
}
