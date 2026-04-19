import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { getBudgetSummary, getTotalTokens, reportTokenUsage } from "../budget.js";
import { parseTodo } from "../parser.js";
import { buildBar, C } from "./helpers.js";

export async function cmdBudget(todoPath: string, args: string[]): Promise<number> {
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);

	// Sub-command: evalgate budget <id> <tokens> — record usage
	const positional = args.filter((a) => !a.startsWith("--"));
	if (positional.length >= 2) {
		const [contractId, tokensRaw] = positional;
		const tokens = parseInt(tokensRaw, 10);
		if (Number.isNaN(tokens) || tokens < 0) {
			console.error(`${C.red}evalgate budget: tokens must be a non-negative integer${C.reset}`);
			return 1;
		}
		const contract = contracts.find(
			(c) => c.id === contractId || c.title.toLowerCase() === contractId?.toLowerCase(),
		);
		if (!contract) {
			console.error(`${C.red}evalgate: contract not found: ${contractId}${C.reset}`);
			return 1;
		}
		const record = reportTokenUsage(todoPath, contract.id, tokens, contract);
		const total = getTotalTokens(todoPath, contract.id);
		console.log(
			`${C.green}recorded${C.reset} ${tokens.toLocaleString()} tokens for ${C.bold}${contract.title}${C.reset}` +
				` ${C.dim}(total: ${total.toLocaleString()}${contract.budget ? ` / ${contract.budget.toLocaleString()}` : ""})${C.reset}`,
		);
		if (contract.budget && total > contract.budget) {
			console.log(
				`${C.red}⚠ budget exceeded by ${(total - contract.budget).toLocaleString()} tokens${C.reset}`,
			);
		}
		void record;
		return 0;
	}

	// Default: show budget summary table
	const summary = getBudgetSummary(todoPath, contracts);
	const anyBudget = summary.some((s) => s.budget !== undefined || s.used > 0);

	if (!anyBudget) {
		console.log(`${C.dim}no budget data yet — use: evalgate budget <id> <tokens>${C.reset}`);
		return 0;
	}

	console.log(`${C.bold}evalgate budget${C.reset} ${C.dim}· ${basename(todoPath)}${C.reset}\n`);

	for (const s of summary) {
		if (s.budget === undefined && s.used === 0) continue;

		const status = s.exceeded
			? `${C.red}exceeded${C.reset}`
			: s.budget !== undefined
				? `${C.green}ok${C.reset}`
				: `${C.dim}no limit${C.reset}`;

		const bar = s.budget && s.budget > 0 ? buildBar(s.used, s.budget, 20) : "";

		console.log(`  ${C.bold}${s.contractTitle}${C.reset} ${C.dim}(${s.contractId})${C.reset}`);
		console.log(
			`  ${C.dim}used:${C.reset} ${s.used.toLocaleString()}` +
				(s.budget ? ` ${C.dim}/ ${s.budget.toLocaleString()}${C.reset}` : "") +
				(bar ? `  ${bar}` : "") +
				`  ${status}`,
		);
	}

	return 0;
}
