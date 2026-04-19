import { existsSync } from "node:fs";
import { basename } from "node:path";
import { detectPatterns } from "../memory.js";
import { C } from "./helpers.js";

export async function cmdPatterns(todoPath: string): Promise<number> {
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const patterns = detectPatterns(todoPath);

	if (patterns.length === 0) {
		console.log(`${C.dim}no failure patterns detected${C.reset}`);
		return 0;
	}

	console.log(`${C.bold}evalgate patterns${C.reset} ${C.dim}· ${basename(todoPath)}${C.reset}\n`);

	for (const p of patterns) {
		const flakyTag = p.flaky ? ` ${C.yellow}(flaky)${C.reset}` : "";
		console.log(
			`  ${C.bold}${p.contractTitle}${C.reset}${flakyTag} ${C.dim}(${p.contractId})${C.reset}`,
		);
		const rate = Math.round(p.failureRate * 100);
		const rateColor = rate >= 75 ? C.red : rate >= 40 ? C.yellow : C.dim;
		console.log(
			`  ${C.dim}runs: ${p.totalRuns} · failures: ${C.reset}${rateColor}${p.failures}${C.reset}` +
				` ${C.dim}· passes: ${p.passes} · rate: ${C.reset}${rateColor}${rate}%${C.reset}`,
		);
		if (p.topErrors.length > 0) {
			for (const e of p.topErrors) {
				console.log(`  ${C.dim}│${C.reset} ${C.dim}${e}${C.reset}`);
			}
		}
		console.log();
	}
	return 0;
}
