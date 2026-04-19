import { existsSync } from "node:fs";
import { basename } from "node:path";
import { retryWorker, runSwarm } from "../swarm.js";
import { loadState } from "../swarm-state.js";
import { C } from "./helpers.js";

export async function cmdSwarm(todoPath: string, args: string[]): Promise<number> {
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const concurrencyArg = args.find((a) => a.startsWith("--concurrency="))?.split("=")[1];
	const concurrency = concurrencyArg ? parseInt(concurrencyArg, 10) : 3;
	const resume = args.includes("--resume");
	const agentCmdArg = args.find((a) => a.startsWith("--agent="))?.split("=")[1];

	// Sub-command: swarm retry <worker-id> — retry a single failed worker
	if (args.includes("retry")) {
		const retryIdx = args.indexOf("retry");
		const workerId = args.slice(retryIdx + 1).find((a) => !a.startsWith("--"));
		if (!workerId) {
			console.error(`${C.red}evalgate swarm retry: missing worker id${C.reset}`);
			console.error(`  usage: evalgate swarm retry <worker-id> [todo-path]`);
			return 1;
		}
		console.log(
			`${C.bold}evalgate swarm retry${C.reset} ${C.dim}·${C.reset} worker ${C.cyan}${workerId}${C.reset}\n`,
		);
		try {
			const worker = await retryWorker(workerId, todoPath, {
				todoPath,
				agentCmd: agentCmdArg,
			});
			if (worker.status === "done") {
				console.log(
					`${C.green}✓${C.reset} ${worker.contractTitle} ${C.dim}(${worker.id})${C.reset} ${C.green}done${C.reset}`,
				);
				return 0;
			}
			console.log(
				`${C.red}✗${C.reset} ${worker.contractTitle} ${C.dim}(${worker.id})${C.reset} ${C.red}failed${C.reset}`,
			);
			if (worker.logPath) {
				console.log(`  ${C.dim}log: ${worker.logPath}${C.reset}`);
			}
			return 1;
		} catch (err) {
			console.error(
				`${C.red}evalgate swarm retry error:${C.reset}`,
				err instanceof Error ? err.message : err,
			);
			return 1;
		}
	}

	// Sub-command: swarm status — print state from last run
	if (args.includes("status")) {
		const state = loadState(todoPath);
		if (!state) {
			console.log(`${C.dim}no swarm state found — run: evalgate swarm${C.reset}`);
			return 0;
		}
		console.log(
			`${C.bold}evalgate swarm status${C.reset} ${C.dim}· ${state.id}${C.reset} ${C.dim}(${new Date(state.ts).toLocaleString()})${C.reset}\n`,
		);
		for (const w of state.workers) {
			const statusColor =
				w.status === "done"
					? C.green
					: w.status === "failed"
						? C.red
						: w.status === "running" || w.status === "spawning"
							? C.cyan
							: C.yellow;
			const mark =
				w.status === "done"
					? `${C.green}✓${C.reset}`
					: w.status === "failed"
						? `${C.red}✗${C.reset}`
						: `${C.yellow}○${C.reset}`;
			console.log(
				`${mark} ${C.bold}${w.contractTitle}${C.reset}  ${statusColor}${w.status}${C.reset} ${C.dim}(${w.id})${C.reset}`,
			);
			if (w.status === "failed" || w.status === "done") {
				if (w.startedAt && w.finishedAt) {
					const ms = new Date(w.finishedAt).getTime() - new Date(w.startedAt).getTime();
					console.log(`  ${C.dim}duration: ${ms}ms${C.reset}`);
				}
				if (w.verifierPassed !== undefined) {
					console.log(
						`  ${C.dim}verifier: ${w.verifierPassed ? `${C.green}passed${C.reset}` : `${C.red}failed${C.reset}`}${C.dim}  log: ${w.logPath}${C.reset}`,
					);
				}
			}
		}
		return 0;
	}

	console.log(
		`${C.bold}evalgate swarm${C.reset} ${C.dim}·${C.reset} ${basename(todoPath)} ${C.dim}· concurrency ${concurrency}${resume ? " · resuming" : ""}${C.reset}\n`,
	);

	try {
		const result = await runSwarm({
			todoPath,
			concurrency,
			resume,
			agentCmd: agentCmdArg,
		});

		for (const w of result.state.workers) {
			const mark =
				w.status === "done"
					? `${C.green}✓${C.reset}`
					: w.status === "failed"
						? `${C.red}✗${C.reset}`
						: `${C.yellow}○${C.reset}`;
			const statusLabel =
				w.status === "done"
					? `${C.green}done${C.reset}`
					: w.status === "failed"
						? `${C.red}failed${C.reset}`
						: `${C.dim}${w.status}${C.reset}`;
			console.log(`  ${mark} ${w.contractTitle} ${C.dim}(${w.id})${C.reset} ${statusLabel}`);
		}

		console.log(
			`\n${C.bold}Swarm summary:${C.reset} ${C.green}${result.done} merged${C.reset}, ${result.failed > 0 ? C.red : C.dim}${result.failed} failed${C.reset}, ${C.dim}${result.skipped} skipped${C.reset}`,
		);
		return result.failed > 0 ? 1 : 0;
	} catch (err) {
		console.error(
			`${C.red}evalgate swarm error:${C.reset}`,
			err instanceof Error ? err.message : err,
		);
		return 1;
	}
}
