/**
 * evalgate web UI server — v0.5
 *
 * Serves a single-page dashboard over node:http. Zero runtime deps.
 *
 * Routes:
 *   GET /          → full HTML dashboard
 *   GET /api/state → JSON snapshot (contracts, runs, messages)
 *   GET /api/stream → SSE stream; pushes {"type":"run"} events on each run
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { getBudgetSummary } from "./budget.js";
import { onRun, queryRuns } from "./log.js";
import { detectPatterns } from "./memory.js";
import { listMessages } from "./messages.js";
import { parseTodo } from "./parser.js";
import { swarmEvents } from "./swarm.js";
import { loadState } from "./swarm-state.js";
import type { RunRecord, SwarmState } from "./types.js";
import { htmlDashboard } from "./ui-html.js";

export interface UiServerOptions {
	todoPath: string;
	port?: number;
}

export interface UiServerHandle {
	stop: () => void;
	port: number;
}

export function startUiServer(opts: UiServerOptions): UiServerHandle {
	const todoPath = resolve(opts.todoPath);
	const port = opts.port ?? 7777;

	// Track SSE clients (verifier runs)
	const clients = new Set<ServerResponse>();
	// Track SSE clients for swarm events
	const swarmClients = new Set<ServerResponse>();

	function broadcast(record: RunRecord): void {
		const data = `data: ${JSON.stringify({ type: "run", record })}\n\n`;
		for (const res of clients) {
			try {
				res.write(data);
			} catch {
				clients.delete(res);
			}
		}
	}

	function broadcastSwarm(state: SwarmState): void {
		const data = `data: ${JSON.stringify({ type: "swarm", state })}\n\n`;
		for (const res of swarmClients) {
			try {
				res.write(data);
			} catch {
				swarmClients.delete(res);
			}
		}
	}

	const unsubscribe = onRun(broadcast);

	// Subscribe to swarm state changes
	swarmEvents.on("state", broadcastSwarm);

	function buildState(): object {
		const contracts = existsSync(todoPath) ? parseTodo(readFileSync(todoPath, "utf8")) : [];
		const runs = queryRuns(todoPath, { limit: 30 });
		const messages = listMessages(todoPath, { limit: 20 });
		const budgetSummary = getBudgetSummary(todoPath, contracts);
		const patterns = detectPatterns(todoPath);
		return { todoPath, contracts, runs, messages, budgetSummary, patterns };
	}

	function handleRequest(req: IncomingMessage, res: ServerResponse): void {
		const url = req.url ?? "/";

		if (url === "/" || url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(htmlDashboard());
			return;
		}

		if (url === "/api/state") {
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			});
			res.end(JSON.stringify(buildState()));
			return;
		}

		if (url === "/api/stream") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			// Send a heartbeat comment to establish the connection
			res.write(": connected\n\n");
			clients.add(res);

			// Send a keepalive every 20s so proxies don't close the connection
			const keepalive = setInterval(() => {
				try {
					res.write(": ping\n\n");
				} catch {
					/* client gone */
				}
			}, 20_000);

			req.on("close", () => {
				clearInterval(keepalive);
				clients.delete(res);
			});
			return;
		}

		// Swarm state snapshot
		if (url === "/api/swarm-state") {
			const swarmState = loadState(todoPath);
			res.writeHead(200, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			});
			res.end(JSON.stringify(swarmState ?? null));
			return;
		}

		// Swarm live event stream
		if (url === "/api/swarm-events") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			res.write(": connected\n\n");
			// Send current state immediately so the UI renders without waiting
			const current = loadState(todoPath);
			if (current) {
				res.write(`data: ${JSON.stringify({ type: "swarm", state: current })}\n\n`);
			}
			swarmClients.add(res);

			const keepalive = setInterval(() => {
				try {
					res.write(": ping\n\n");
				} catch {
					/* client gone */
				}
			}, 20_000);

			req.on("close", () => {
				clearInterval(keepalive);
				swarmClients.delete(res);
			});
			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("not found");
	}

	const server = createServer(handleRequest);
	server.listen(port);

	return {
		port,
		stop() {
			unsubscribe();
			swarmEvents.off("state", broadcastSwarm);
			for (const res of [...clients, ...swarmClients]) {
				try {
					res.end();
				} catch {
					/* ignore */
				}
			}
			clients.clear();
			swarmClients.clear();
			server.close();
		},
	};
}
