import { existsSync } from "node:fs";
import { suggest } from "../memory.js";
import { C } from "./helpers.js";

export async function cmdSuggest(query: string, todoPath: string): Promise<number> {
	if (!query) {
		console.error(`${C.red}evalgate suggest: query required${C.reset}`);
		console.error(`  usage: evalgate suggest "<title>" [path]`);
		return 1;
	}
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const results = suggest(todoPath, query, 5);

	if (results.length === 0) {
		console.log(`${C.dim}no similar past completions found${C.reset}`);
		return 0;
	}

	console.log(`${C.bold}evalgate suggest${C.reset} ${C.dim}·${C.reset} "${query}"\n`);

	for (const r of results) {
		const sim = Math.round(r.similarity * 100);
		const simColor = sim >= 60 ? C.green : sim >= 30 ? C.yellow : C.dim;
		console.log(
			`  ${simColor}${sim}%${C.reset} ${C.bold}${r.contractTitle}${C.reset} ${C.dim}(${r.contractId})${C.reset}`,
		);
		if (r.verifier) {
			console.log(`       ${C.dim}eval:${C.reset} ${C.cyan}${r.verifier}${C.reset}`);
		}
		console.log(
			`       ${C.dim}pass rate: ${Math.round(r.passRate * 100)}% · ${r.runCount} run(s)${C.reset}`,
		);
	}
	return 0;
}
