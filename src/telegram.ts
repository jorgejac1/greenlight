/**
 * Raw Telegram Bot API client — zero dependencies, uses node:https only.
 *
 * All requests go to https://api.telegram.org/bot<token>/<method>.
 * getUpdates uses long-polling (timeout=25) so no sleep is needed between
 * calls — the server holds the connection open for up to 25 seconds.
 */

import { request } from "node:https";
import type { TelegramUpdate } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function httpsGet(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = request(url, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				const body = Buffer.concat(chunks).toString("utf8");
				const status = res.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					reject(new Error(`Telegram HTTP ${status}: ${body}`));
				} else {
					resolve(body);
				}
			});
		});
		req.on("error", reject);
		req.end();
	});
}

function httpsPost(url: string, payload: unknown): Promise<string> {
	return new Promise((resolve, reject) => {
		const body = JSON.stringify(payload);
		const urlObj = new URL(url);
		const options = {
			hostname: urlObj.hostname,
			path: urlObj.pathname + urlObj.search,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body),
			},
		};
		const req = request(options, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				const responseBody = Buffer.concat(chunks).toString("utf8");
				const status = res.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					reject(new Error(`Telegram HTTP ${status}: ${responseBody}`));
				} else {
					resolve(responseBody);
				}
			});
		});
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Long-poll for new updates. Pass `offset = lastUpdateId + 1` to acknowledge
 * previously received updates. `timeout=25` means the server holds the
 * connection for up to 25 seconds before returning an empty array.
 */
export async function getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
	const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25&limit=10`;
	const body = await httpsGet(url);
	const parsed = JSON.parse(body) as { ok: boolean; result: TelegramUpdate[] };
	if (!parsed.ok) {
		throw new Error(`Telegram getUpdates failed: ${body}`);
	}
	return parsed.result;
}

/** Send a plain-text message to a chat. */
export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const body = await httpsPost(url, { chat_id: chatId, text });
	const parsed = JSON.parse(body) as { ok: boolean };
	if (!parsed.ok) {
		throw new Error(`Telegram sendMessage failed: ${body}`);
	}
}

/** Send a Markdown-formatted message to a chat. */
export async function sendMarkdown(token: string, chatId: number, text: string): Promise<void> {
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const body = await httpsPost(url, {
		chat_id: chatId,
		text,
		parse_mode: "Markdown",
	});
	const parsed = JSON.parse(body) as { ok: boolean };
	if (!parsed.ok) {
		throw new Error(`Telegram sendMarkdown failed: ${body}`);
	}
}
