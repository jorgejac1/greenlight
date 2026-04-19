import { existsSync } from "node:fs";
import { queryRuns } from "../log.js";
import { C } from "./helpers.js";

export async function cmdLog(todoPath: string, args: string[]): Promise<number> {
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const contractId = args.find((a) => a.startsWith("--contract="))?.split("=")[1];
	const failedOnly = args.includes("--failed");
	const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
	const limit = limitArg ? parseInt(limitArg, 10) : 20;

	const records = queryRuns(todoPath, {
		contractId,
		passed: failedOnly ? false : undefined,
		limit,
	});

	if (records.length === 0) {
		console.log(`${C.dim}no run history found${C.reset}`);
		return 0;
	}

	console.log(`${C.bold}evalgate log${C.reset} ${C.dim}· ${records.length} run(s)${C.reset}\n`);
	for (const r of records) {
		const status = r.passed ? `${C.green}✓ passed${C.reset}` : `${C.red}✗ failed${C.reset}`;
		const ts = new Date(r.ts).toLocaleString();
		console.log(
			`${status}  ${C.bold}${r.contractTitle}${C.reset} ${C.dim}(${r.contractId})${C.reset}`,
		);
		console.log(
			`  ${C.dim}${ts} · ${r.trigger} · exit ${r.exitCode} · ${r.durationMs}ms${C.reset}`,
		);
	}
	return 0;
}
