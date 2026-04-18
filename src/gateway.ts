/**
 * evalgate Telegram gateway — v0.10
 *
 * Long-polls Telegram for messages, dispatches commands to evalgate operations,
 * and sends results back. Runs as a persistent background process.
 *
 * Security: only responds to the configured chatId. All other senders are
 * silently ignored.
 *
 * PID file: written to <todoDir>/.evalgate/gateway.pid on start, removed on
 * clean exit. Used by the UI server to show gateway status.
 *
 * Zero runtime dependencies — node:fs, node:path, node:os only.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { parseTodo } from "./parser.js";
import { runSwarm } from "./swarm.js";
import { loadState } from "./swarm-state.js";
import { getUpdates, sendMarkdown, sendMessage } from "./telegram.js";
import type { GatewayConfig } from "./types.js";
import { runContract } from "./verifier.js";
import { updateTodo } from "./writer.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GatewayOptions {
	config: GatewayConfig;
	/** Override the todo path from config for this session. */
	todoPath?: string;
}

// ---------------------------------------------------------------------------
// PID file management
// ---------------------------------------------------------------------------

function pidFilePath(todoPath: string): string {
	return join(dirname(todoPath), ".evalgate", "gateway.pid");
}

function writePid(todoPath: string): void {
	const dir = join(dirname(todoPath), ".evalgate");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(
		pidFilePath(todoPath),
		JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }),
	);
}

function removePid(todoPath: string): void {
	const p = pidFilePath(todoPath);
	try {
		if (existsSync(p)) rmSync(p);
	} catch {
		// best-effort
	}
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `*evalgate gateway commands*

/help — show this message
/status — show swarm worker status
/list — list contracts and their state
/check — run verifiers on all pending contracts
/swarm — launch swarm (spawns agents for each pending contract)
/retry <id> — retry a single contract (coming soon)`;

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleHelp(token: string, chatId: number): Promise<void> {
	await sendMarkdown(token, chatId, HELP_TEXT);
}

async function handleStatus(token: string, chatId: number, todoPath: string): Promise<void> {
	const state = loadState(todoPath);
	if (!state) {
		await sendMessage(token, chatId, "No swarm state found — run /swarm to start one.");
		return;
	}

	const lines: string[] = [`*Swarm ${state.id}* (${new Date(state.ts).toLocaleString()})\n`];
	for (const w of state.workers) {
		const icon = w.status === "done" ? "✅" : w.status === "failed" ? "❌" : "🔄";
		lines.push(`${icon} ${w.contractTitle} — \`${w.status}\``);
	}

	const done = state.workers.filter((w) => w.status === "done").length;
	const failed = state.workers.filter((w) => w.status === "failed").length;
	const pending = state.workers.filter((w) => w.status === "pending").length;
	lines.push(`\n${done} done · ${failed} failed · ${pending} pending`);

	await sendMarkdown(token, chatId, lines.join("\n"));
}

async function handleList(token: string, chatId: number, todoPath: string): Promise<void> {
	if (!existsSync(todoPath)) {
		await sendMessage(token, chatId, `File not found: ${todoPath}`);
		return;
	}

	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);

	if (contracts.length === 0) {
		await sendMessage(token, chatId, "No contracts found in todo.md");
		return;
	}

	const lines: string[] = ["*Contracts*\n"];
	for (const c of contracts) {
		const icon = c.checked ? "✅" : c.verifier ? "⬜" : "▫️";
		const gated = c.verifier ? "" : " _(no verifier)_";
		lines.push(`${icon} ${c.title}${gated}`);
	}

	const pending = contracts.filter((c) => !c.checked && c.verifier).length;
	const passed = contracts.filter((c) => c.checked).length;
	lines.push(`\n${passed} passed · ${pending} pending`);

	await sendMarkdown(token, chatId, lines.join("\n"));
}

async function handleCheck(token: string, chatId: number, todoPath: string): Promise<void> {
	if (!existsSync(todoPath)) {
		await sendMessage(token, chatId, `File not found: ${todoPath}`);
		return;
	}

	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);
	const pending = contracts.filter((c) => !c.checked && c.verifier);

	if (pending.length === 0) {
		await sendMessage(token, chatId, "No pending contracts with verifiers.");
		return;
	}

	await sendMessage(token, chatId, `Running ${pending.length} verifier(s)…`);

	const cwd = resolvePath(dirname(todoPath));
	let passed = 0;
	let failed = 0;
	const lines: string[] = ["*Check results*\n"];
	const results: import("./types.js").RunResult[] = [];

	for (const c of pending) {
		const result = await runContract(c, cwd, { todoPath, trigger: "manual" });
		results.push(result);
		if (result.passed) {
			lines.push(`✅ ${c.title}`);
			passed++;
		} else {
			// Show up to 5 lines of output to keep Telegram messages readable
			const output = [result.stdout, result.stderr]
				.join("\n")
				.trim()
				.split("\n")
				.slice(-5)
				.join("\n");
			lines.push(`❌ ${c.title}\n\`\`\`\n${output}\n\`\`\``);
			failed++;
		}
	}

	// Persist checkbox updates using the results already collected
	const updated = updateTodo(source, results);
	if (updated !== source) {
		writeFileSync(todoPath, updated);
	}

	lines.push(`\n${passed} passed · ${failed} failed`);
	await sendMarkdown(token, chatId, lines.join("\n"));
}

async function handleSwarm(
	token: string,
	chatId: number,
	todoPath: string,
	concurrency: number,
): Promise<void> {
	if (!existsSync(todoPath)) {
		await sendMessage(token, chatId, `File not found: ${todoPath}`);
		return;
	}

	await sendMessage(token, chatId, `Starting swarm (concurrency ${concurrency})…`);

	try {
		const result = await runSwarm({ todoPath, concurrency });

		const lines: string[] = ["*Swarm complete*\n"];
		for (const w of result.state.workers) {
			const icon = w.status === "done" ? "✅" : "❌";
			lines.push(`${icon} ${w.contractTitle}`);
		}
		lines.push(`\n${result.done} merged · ${result.failed} failed · ${result.skipped} skipped`);

		await sendMarkdown(token, chatId, lines.join("\n"));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await sendMessage(token, chatId, `Swarm error: ${msg}`);
	}
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

async function dispatch(
	text: string,
	token: string,
	chatId: number,
	todoPath: string,
	concurrency: number,
): Promise<void> {
	const trimmed = text.trim();

	// Strip bot username suffix (e.g. /help@mybot)
	const cmd = trimmed.split("@")[0]?.toLowerCase() ?? "";

	if (cmd === "/help") {
		await handleHelp(token, chatId);
		return;
	}

	if (cmd === "/status") {
		await handleStatus(token, chatId, todoPath);
		return;
	}

	if (cmd === "/list") {
		await handleList(token, chatId, todoPath);
		return;
	}

	if (cmd === "/check") {
		await handleCheck(token, chatId, todoPath);
		return;
	}

	if (cmd === "/swarm") {
		await handleSwarm(token, chatId, todoPath, concurrency);
		return;
	}

	if (cmd.startsWith("/retry")) {
		await sendMessage(token, chatId, "retry is not yet available in this version.");
		return;
	}

	await sendMessage(token, chatId, `Unknown command: ${cmd}\nSend /help for a list of commands.`);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

/**
 * Starts the Telegram gateway. Runs indefinitely until the process receives
 * SIGINT or SIGTERM. Writes a PID file on start and removes it on exit.
 */
export async function runGateway(opts: GatewayOptions): Promise<void> {
	const { config } = opts;
	const todoPath = resolvePath(opts.todoPath ?? config.todoPath);
	const concurrency = config.concurrency ?? 3;
	const { token, chatId } = config;

	writePid(todoPath);

	const cleanup = (): void => {
		removePid(todoPath);
	};
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
	process.on("exit", cleanup);

	// Announce startup
	try {
		await sendMessage(token, chatId, "evalgate gateway online. Send /help for commands.");
	} catch (err) {
		// If we can't send the startup message, the token/chatId is probably wrong.
		// Re-throw so the CLI can surface a useful error.
		removePid(todoPath);
		throw new Error(
			`Failed to send startup message — check token and chat ID: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let offset = 0;

	// Long-poll loop — getUpdates blocks for up to 25s per call so no sleep needed.
	while (true) {
		let updates: import("./types.js").TelegramUpdate[];
		try {
			updates = await getUpdates(token, offset);
		} catch (err) {
			// Network errors are transient; log and retry immediately
			process.stderr.write(
				`[gateway] getUpdates error: ${err instanceof Error ? err.message : String(err)}\n`,
			);
			continue;
		}

		for (const update of updates) {
			offset = update.update_id + 1;

			const msg = update.message;
			if (!msg) continue;

			// Security: ignore messages from anyone other than the configured chat
			if (msg.chat.id !== chatId) continue;

			const text = msg.text;
			if (!text) continue;

			// Dispatch asynchronously so slow commands don't block the poll loop
			dispatch(text, token, chatId, todoPath, concurrency).catch((err) => {
				process.stderr.write(
					`[gateway] dispatch error: ${err instanceof Error ? err.message : String(err)}\n`,
				);
			});
		}
	}
}
