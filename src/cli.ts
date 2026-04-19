#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cmdBudget } from "./cli/budget.js";
import { cmdCheck } from "./cli/check.js";
import { cmdDiff } from "./cli/diff.js";
import { cmdExport } from "./cli/export.js";
import { cmdGateway, cmdGatewaySetup } from "./cli/gateway.js";
import { C } from "./cli/helpers.js";
import { cmdList } from "./cli/list.js";
import { cmdLog } from "./cli/log.js";
import { cmdMsg } from "./cli/msg.js";
import { cmdPatterns } from "./cli/patterns.js";
import { cmdRetry } from "./cli/retry.js";
import { cmdSuggest } from "./cli/suggest.js";
import { cmdSwarm } from "./cli/swarm.js";
import { startMcpServer } from "./mcp.js";
import { startWatcher } from "./watcher.js";

function usage(): void {
	console.log(
		`
${C.bold}evalgate${C.reset} — eval-gated todos for agents

${C.bold}USAGE${C.reset}
  evalgate check  [path] [--watch]    Run verifiers; --watch re-checks on file change
  evalgate list   [path]              List contracts and their status
  evalgate retry  <id> [path]         Rerun a contract with last failure context
  evalgate log    [path] [--contract=<id>] [--failed] [--limit=N]
  evalgate msg    send <from> <to> <kind> [payload-json] [path]
  evalgate msg    list [--to=<agent>] [--kind=<kind>] [path]
  evalgate serve  [cwd]               Start MCP server on stdio
  evalgate watch  [path]              Start trigger daemon (schedule/watch/webhook)
  evalgate ui     [path] [--port=N]   Start web dashboard (default port 7777)
  evalgate dash   [path]              Live ANSI terminal dashboard
  evalgate budget [path]              Show per-contract token spend vs budget
  evalgate budget <id> <tokens> [path]  Record token usage for a contract
  evalgate suggest "<title>" [path]   Find similar past successful completions
  evalgate patterns [path]            Show failure patterns from run history
  evalgate export [path] [--format=json|md]  Export full project snapshot
  evalgate diff <a.json> <b.json> [--format=text|json|md]  Diff two snapshots
  evalgate swarm  [path] [--concurrency=N] [--resume] [--agent=cmd]
  evalgate swarm  status [path]       Show swarm worker status
  evalgate swarm  retry <id> [path]   Retry a single failed swarm worker
  evalgate gateway setup              Configure Telegram bot token and chat ID
  evalgate gateway [--todo=path]      Start Telegram bot gateway
  evalgate help                       Show this message

${C.bold}CONTRACT FORMAT${C.reset} (todo.md)
  - [ ] Refactor auth middleware to use JWT
    - eval: \`pnpm test src/auth && pnpm lint src/auth\`
    - retries: 3
    - budget: 50k

${C.dim}If no path is given, ./todo.md is used.${C.reset}
  `.trim(),
	);
}

async function main(): Promise<void> {
	const [cmd, ...args] = process.argv.slice(2);

	let exitCode = 0;
	switch (cmd) {
		case "check": {
			const positional = args.filter((a) => !a.startsWith("--"));
			const todoPath = positional[0] ?? "todo.md";
			const watchMode = args.includes("--watch");
			exitCode = await cmdCheck(todoPath, watchMode);
			if (watchMode) return;
			break;
		}
		case "list": {
			const todoPath = args[0] ?? "todo.md";
			exitCode = await cmdList(todoPath);
			break;
		}
		case "retry": {
			const [contractId, todoPath = "todo.md"] = args;
			exitCode = await cmdRetry(contractId ?? "", todoPath);
			break;
		}
		case "log": {
			const flags = args.filter((a) => a.startsWith("--"));
			const positional = args.filter((a) => !a.startsWith("--"));
			const todoPath = positional[0] ?? "todo.md";
			exitCode = await cmdLog(todoPath, flags);
			break;
		}
		case "msg": {
			const [subCmd, ...rest] = args;
			const flags = rest.filter((a) => a.startsWith("--"));
			const positional = rest.filter((a) => !a.startsWith("--"));
			const todoPath = (subCmd === "list" ? positional[0] : positional[4]) ?? "todo.md";
			const msgArgs = subCmd === "list" ? flags : [...positional.slice(0, 4), ...flags];
			exitCode = await cmdMsg(subCmd ?? "", msgArgs, todoPath);
			break;
		}
		case "serve": {
			const positionalArgs = args.filter((a) => !a.startsWith("--"));
			const flagArgs = args.filter((a) => a.startsWith("--workspace="));
			const cwd = positionalArgs[0] ? resolve(positionalArgs[0]) : process.cwd();
			const workspaces: Record<string, string> = {};
			for (const flag of flagArgs) {
				const value = flag.slice("--workspace=".length);
				const colonIdx = value.indexOf(":");
				if (colonIdx > 0) {
					const name = value.slice(0, colonIdx).trim();
					const wsPath = value.slice(colonIdx + 1).trim();
					if (name && wsPath) workspaces[name] = wsPath;
				}
			}
			startMcpServer(cwd, { workspaces });
			return;
		}
		case "watch": {
			const todoPath = resolve(args[0] ?? "todo.md");
			const portArg = args.find((a) => a.startsWith("--port="));
			const port = portArg ? parseInt(portArg.split("=")[1], 10) : 7778;
			const noSchedule = args.includes("--no-schedule");
			const noWatch = args.includes("--no-watch");
			const noWebhook = args.includes("--no-webhook");

			if (!existsSync(todoPath)) {
				console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
				process.exit(1);
			}

			const handle = startWatcher({
				todoPath,
				webhookPort: port,
				enableSchedule: !noSchedule,
				enableWatch: !noWatch,
				enableWebhook: !noWebhook,
			});

			process.on("SIGINT", () => {
				handle.stop();
				process.exit(0);
			});
			process.on("SIGTERM", () => {
				handle.stop();
				process.exit(0);
			});
			return;
		}
		case "budget": {
			const flags = args.filter((a) => a.startsWith("--"));
			const positional = args.filter((a) => !a.startsWith("--"));
			let todoPath: string;
			let subArgs: string[];
			const firstLooksLikePath =
				positional.length > 0 &&
				(positional[0].endsWith(".md") || existsSync(resolve(positional[0])));
			if (firstLooksLikePath) {
				todoPath = resolve(positional[0]);
				subArgs = [...positional.slice(1), ...flags];
			} else if (positional.length >= 2) {
				todoPath = resolve(positional[2] ?? "todo.md");
				subArgs = [...positional.slice(0, 2), ...flags];
			} else {
				todoPath = resolve("todo.md");
				subArgs = [...positional, ...flags];
			}
			exitCode = await cmdBudget(todoPath, subArgs);
			break;
		}
		case "ui": {
			const flags = args.filter((a) => a.startsWith("--"));
			const positional = args.filter((a) => !a.startsWith("--"));
			const todoPath = resolve(positional[0] ?? "todo.md");
			const portArg = flags.find((a) => a.startsWith("--port="));
			const port = portArg ? parseInt(portArg.split("=")[1], 10) : 7777;

			if (!existsSync(todoPath)) {
				console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
				process.exit(1);
			}

			const { startUiServer } = await import("./ui.js");
			const handle = startUiServer({ todoPath, port });

			console.log(
				`${C.bold}evalgate ui${C.reset} ${C.dim}·${C.reset} ` +
					`${C.cyan}http://localhost:${handle.port}${C.reset} ` +
					`${C.dim}· ${todoPath}${C.reset}`,
			);
			console.log(`${C.dim}Press Ctrl+C to stop.${C.reset}`);

			process.on("SIGINT", () => {
				handle.stop();
				process.exit(0);
			});
			process.on("SIGTERM", () => {
				handle.stop();
				process.exit(0);
			});
			return;
		}
		case "dash": {
			const positional = args.filter((a) => !a.startsWith("--"));
			const todoPath = resolve(positional[0] ?? "todo.md");

			if (!existsSync(todoPath)) {
				console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
				process.exit(1);
			}

			const { startDash } = await import("./dash.js");
			const handle = startDash(todoPath);

			process.on("SIGINT", () => {
				handle.stop();
				process.exit(0);
			});
			process.on("SIGTERM", () => {
				handle.stop();
				process.exit(0);
			});
			return;
		}
		case "suggest": {
			const positional = args.filter((a) => !a.startsWith("--"));
			const query = positional[0] ?? "";
			const todoPath = resolve(positional[1] ?? "todo.md");
			exitCode = await cmdSuggest(query, todoPath);
			break;
		}
		case "patterns": {
			const positional = args.filter((a) => !a.startsWith("--"));
			const todoPath = resolve(positional[0] ?? "todo.md");
			exitCode = await cmdPatterns(todoPath);
			break;
		}
		case "export": {
			const flags = args.filter((a) => a.startsWith("--"));
			const positional = args.filter((a) => !a.startsWith("--"));
			const todoPath = resolve(positional[0] ?? "todo.md");
			const formatArg = flags.find((a) => a.startsWith("--format="))?.split("=")[1];
			const format = formatArg === "md" ? "md" : "json";
			exitCode = await cmdExport(todoPath, format);
			break;
		}
		case "diff": {
			const flags = args.filter((a) => a.startsWith("--"));
			const positional = args.filter((a) => !a.startsWith("--"));
			const [pathA, pathB] = positional;
			if (!pathA || !pathB) {
				console.error(`${C.red}evalgate diff: two snapshot paths required${C.reset}`);
				console.error(`  usage: evalgate diff <a.json> <b.json> [--format=text|json|md]`);
				exitCode = 1;
				break;
			}
			const formatArg = flags.find((a) => a.startsWith("--format="))?.split("=")[1];
			const format = formatArg === "json" ? "json" : formatArg === "md" ? "md" : "text";
			exitCode = await cmdDiff(resolve(pathA), resolve(pathB), format);
			break;
		}
		case "swarm": {
			const flags = args.filter((a) => a.startsWith("--"));
			const positional = args.filter((a) => !a.startsWith("--"));
			const subCmd = ["status", "retry"].includes(positional[0] ?? "") ? positional[0] : undefined;
			let pathArg: string | undefined;
			let swarmArgs: string[];
			if (subCmd === "status") {
				pathArg = positional[1];
				swarmArgs = ["status", ...flags];
			} else if (subCmd === "retry") {
				pathArg = positional[2];
				swarmArgs = ["retry", positional[1] ?? "", ...flags];
			} else {
				pathArg = positional[0];
				swarmArgs = flags;
			}
			const todoPath = resolve(pathArg ?? "todo.md");
			exitCode = await cmdSwarm(todoPath, swarmArgs);
			break;
		}
		case "gateway": {
			const subCmd = args[0];
			if (subCmd === "setup") {
				exitCode = await cmdGatewaySetup();
			} else {
				exitCode = await cmdGateway(args);
			}
			break;
		}
		case "help":
		case "--help":
		case "-h":
		case undefined:
			usage();
			break;
		default:
			console.error(`${C.red}unknown command: ${cmd}${C.reset}\n`);
			usage();
			exitCode = 1;
	}
	process.exit(exitCode);
}

main().catch((e) => {
	console.error(`${C.red}evalgate error:${C.reset}`, e?.stack ?? e);
	process.exit(1);
});
