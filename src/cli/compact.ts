import { resolve } from "node:path";
import { compactLogs } from "../compact.js";
import { C } from "./helpers.js";

export async function cmdCompact(todoPath: string, args: string[]): Promise<number> {
	const flags = args.filter((a) => a.startsWith("--"));
	const dryRun = flags.includes("--dry-run");

	const maxAgeDaysArg = flags.find((a) => a.startsWith("--max-age-days="))?.split("=")[1];
	const maxRowsArg = flags.find((a) => a.startsWith("--max-rows="))?.split("=")[1];

	const maxAgeDays = maxAgeDaysArg !== undefined ? parseInt(maxAgeDaysArg, 10) : undefined;
	const maxRows = maxRowsArg !== undefined ? parseInt(maxRowsArg, 10) : undefined;

	if (maxAgeDays !== undefined && (Number.isNaN(maxAgeDays) || maxAgeDays < 0)) {
		console.error(
			`${C.red}evalgate compact: --max-age-days must be a non-negative integer${C.reset}`,
		);
		return 1;
	}
	if (maxRows !== undefined && (Number.isNaN(maxRows) || maxRows < 1)) {
		console.error(`${C.red}evalgate compact: --max-rows must be a positive integer${C.reset}`);
		return 1;
	}
	if (maxAgeDays === undefined && maxRows === undefined) {
		// Default when called with no opts: 180-day age limit
		const result = compactLogs(resolve(todoPath), { maxAgeDays: 180, dryRun });
		return printResult(result, dryRun);
	}

	const result = compactLogs(resolve(todoPath), { maxAgeDays, maxRows, dryRun });
	return printResult(result, dryRun);
}

function printResult(
	result: { runsDeleted: number; budgetDeleted: number },
	dryRun: boolean,
): number {
	const prefix = dryRun ? `${C.dim}[dry run]${C.reset} ` : "";
	if (result.runsDeleted === 0 && result.budgetDeleted === 0) {
		console.log(`${prefix}Nothing to compact.`);
	} else {
		console.log(
			`${prefix}${C.green}runs${C.reset}: ${result.runsDeleted} rows ${dryRun ? "would be" : ""} deleted`,
		);
		console.log(
			`${prefix}${C.green}budget${C.reset}: ${result.budgetDeleted} rows ${dryRun ? "would be" : ""} deleted`,
		);
	}
	return 0;
}
