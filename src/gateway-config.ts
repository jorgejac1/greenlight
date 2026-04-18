/**
 * Gateway configuration — persisted as ~/.evalgate/gateway.json.
 *
 * Config is intentionally stored outside the project directory so multiple
 * projects can share the same Telegram bot without each needing their own
 * token. The todoPath inside the config is the default; it can be overridden
 * per invocation with --todo= flag.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { GatewayConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Absolute path to ~/.evalgate/gateway.json */
export function configPath(): string {
	return join(homedir(), ".evalgate", "gateway.json");
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/** Returns the persisted config, or null if it doesn't exist or is invalid. */
export function loadConfig(): GatewayConfig | null {
	const p = configPath();
	if (!existsSync(p)) return null;
	try {
		const raw = readFileSync(p, "utf8");
		return JSON.parse(raw) as GatewayConfig;
	} catch {
		return null;
	}
}

/** Persists config to ~/.evalgate/gateway.json, creating the directory if needed. */
export function saveConfig(config: GatewayConfig): void {
	const dir = join(homedir(), ".evalgate");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Interactive setup
// ---------------------------------------------------------------------------

/**
 * Prompts the user on stdin for bot credentials, saves the config, and
 * returns it. Designed to be called once during `evalgate gateway setup`.
 */
export async function setupConfig(): Promise<GatewayConfig> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const ask = (question: string): Promise<string> =>
		new Promise((resolve) => rl.question(question, resolve));

	try {
		console.log("\nevalgate gateway setup\n");

		const token = (await ask("Telegram bot token (from @BotFather): ")).trim();
		if (!token) throw new Error("token is required");

		const chatIdRaw = (
			await ask("Your Telegram chat ID (send /start to your bot then check the update): ")
		).trim();
		const chatId = parseInt(chatIdRaw, 10);
		if (Number.isNaN(chatId)) throw new Error("chat ID must be a number");

		const todoPathRaw = (await ask("Default todo.md path [./todo.md]: ")).trim();
		const todoPath = todoPathRaw || "./todo.md";

		const concurrencyRaw = (await ask("Concurrency (default 3): ")).trim();
		const concurrency = concurrencyRaw ? parseInt(concurrencyRaw, 10) : 3;
		if (Number.isNaN(concurrency) || concurrency < 1) {
			throw new Error("concurrency must be a positive integer");
		}

		const config: GatewayConfig = { token, chatId, todoPath, concurrency };
		saveConfig(config);

		return config;
	} finally {
		rl.close();
	}
}
