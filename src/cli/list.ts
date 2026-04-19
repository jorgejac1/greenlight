import { existsSync, readFileSync } from "node:fs";
import { parseTodo } from "../parser.js";
import { C, formatCommand } from "./helpers.js";

export async function cmdList(todoPath: string): Promise<number> {
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const source = readFileSync(todoPath, "utf8");
	const contracts = parseTodo(source);
	if (contracts.length === 0) {
		console.log(`${C.dim}no contracts found${C.reset}`);
		return 0;
	}

	for (const c of contracts) {
		const mark = c.checked
			? `${C.green}✓${C.reset}`
			: c.verifier
				? `${C.yellow}○${C.reset}`
				: `${C.dim}○${C.reset}`;
		console.log(`${mark} ${c.title} ${C.dim}(${c.id})${C.reset}`);
		if (c.verifier) {
			console.log(`  ${C.dim}eval:${C.reset} ${C.cyan}${formatCommand(c.verifier)}${C.reset}`);
		}
		if (c.retries !== undefined) {
			console.log(`  ${C.dim}retries: ${c.retries}${C.reset}`);
		}
		if (c.budget !== undefined) {
			console.log(`  ${C.dim}budget: ${c.budget.toLocaleString()} tokens${C.reset}`);
		}
	}
	return 0;
}
