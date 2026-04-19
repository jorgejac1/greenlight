import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getLastFailure } from "../log.js";
import { parseTodo } from "../parser.js";
import { runContract } from "../verifier.js";
import { updateTodo } from "../writer.js";
import { C } from "./helpers.js";

export async function cmdRetry(contractId: string, todoPath: string): Promise<number> {
	if (!contractId) {
		console.error(`${C.red}evalgate retry: contract id required${C.reset}`);
		console.error(`  usage: evalgate retry <id> [path]`);
		return 1;
	}
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);
	const normalized = contractId.trim().toLowerCase();
	const contract = contracts.find(
		(c) => c.id === normalized || c.title.toLowerCase() === normalized,
	);

	if (!contract) {
		console.error(`${C.red}evalgate: contract not found: ${contractId}${C.reset}`);
		console.log(`\nAvailable ids:`);
		for (const c of contracts) {
			console.log(`  ${C.dim}${c.id}${C.reset} — ${c.title}`);
		}
		return 1;
	}

	if (!contract.verifier) {
		console.error(`${C.red}evalgate: contract '${contractId}' has no verifier${C.reset}`);
		return 1;
	}

	console.log(
		`${C.bold}evalgate retry${C.reset} ${C.dim}·${C.reset} ${contract.title} ${C.dim}(${contract.id})${C.reset}\n`,
	);

	const lastFailure = getLastFailure(todoPath, contract.id);
	if (lastFailure) {
		const ago = new Date(lastFailure.ts).toLocaleString();
		console.log(
			`${C.bold}Last failure${C.reset} ${C.dim}(${ago}, exit ${lastFailure.exitCode}, ${lastFailure.durationMs}ms):${C.reset}`,
		);
		const combined = [lastFailure.stdout.trim(), lastFailure.stderr.trim()]
			.filter(Boolean)
			.join("\n");
		for (const l of combined.split("\n").slice(-20)) {
			console.log(`  ${C.dim}│${C.reset} ${l}`);
		}
		console.log();
	}

	const cwd = resolve(dirname(todoPath));
	process.stdout.write(`  ${C.dim}▸${C.reset} retrying ... `);
	const result = await runContract(contract, cwd, { todoPath, trigger: "retry" });

	if (result.passed) {
		console.log(`${C.green}✓ passed${C.reset} ${C.dim}(${result.durationMs}ms)${C.reset}`);
		const updated = updateTodo(source, [result]);
		if (updated !== source) writeFileSync(todoPath, updated);
		return 0;
	}

	console.log(
		`${C.red}✗ failed${C.reset} ${C.dim}(exit ${result.exitCode}, ${result.durationMs}ms)${C.reset}`,
	);
	const combined = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
	for (const l of combined.split("\n").slice(-20)) {
		console.log(`  ${C.dim}│${C.reset} ${l}`);
	}

	return 1;
}
