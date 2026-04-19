import { existsSync, readFileSync } from "node:fs";
import { diffSnapshots, diffToMarkdown, type exportSnapshot } from "../memory.js";
import { C } from "./helpers.js";

export async function cmdDiff(
	pathA: string,
	pathB: string,
	format: "json" | "md" | "text",
): Promise<number> {
	if (!existsSync(pathA)) {
		console.error(`${C.red}evalgate diff: file not found: ${pathA}${C.reset}`);
		return 1;
	}
	if (!existsSync(pathB)) {
		console.error(`${C.red}evalgate diff: file not found: ${pathB}${C.reset}`);
		return 1;
	}

	let snapshotA: ReturnType<typeof exportSnapshot>;
	let snapshotB: ReturnType<typeof exportSnapshot>;

	try {
		snapshotA = JSON.parse(readFileSync(pathA, "utf8")) as ReturnType<typeof exportSnapshot>;
	} catch {
		console.error(`${C.red}evalgate diff: failed to parse ${pathA}${C.reset}`);
		return 1;
	}
	try {
		snapshotB = JSON.parse(readFileSync(pathB, "utf8")) as ReturnType<typeof exportSnapshot>;
	} catch {
		console.error(`${C.red}evalgate diff: failed to parse ${pathB}${C.reset}`);
		return 1;
	}

	const diff = diffSnapshots(snapshotA, snapshotB);

	if (format === "json") {
		process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
		return 0;
	}

	if (format === "md") {
		process.stdout.write(`${diffToMarkdown(diff)}\n`);
		return 0;
	}

	// Default text output
	const { contracts, runs, budget, messages } = diff;
	console.log(
		`${C.bold}evalgate diff${C.reset} ${C.dim}·${C.reset} ` +
			`${new Date(diff.from).toLocaleString()} ${C.dim}→${C.reset} ${new Date(diff.to).toLocaleString()}\n`,
	);

	if (contracts.nowPassed.length > 0) {
		for (const t of contracts.nowPassed) console.log(`  ${C.green}✓ passed${C.reset}  ${t}`);
	}
	if (contracts.nowPending.length > 0) {
		for (const t of contracts.nowPending) console.log(`  ${C.yellow}○ regressed${C.reset}  ${t}`);
	}
	if (contracts.added.length > 0) {
		for (const t of contracts.added) console.log(`  ${C.cyan}+ added${C.reset}    ${t}`);
	}
	if (contracts.removed.length > 0) {
		for (const t of contracts.removed) console.log(`  ${C.dim}- removed${C.reset}   ${t}`);
	}
	if (
		contracts.nowPassed.length === 0 &&
		contracts.nowPending.length === 0 &&
		contracts.added.length === 0 &&
		contracts.removed.length === 0
	) {
		console.log(`  ${C.dim}no contract changes${C.reset}`);
	}

	console.log(
		`\n  ${C.dim}runs: +${runs.added} · pass rate: ${runs.passRate.before}% → ${runs.passRate.after}%${C.reset}`,
	);
	if (budget.contractsExceeded.length > 0) {
		console.log(`  ${C.red}⚠ budget exceeded: ${budget.contractsExceeded.join(", ")}${C.reset}`);
	}
	if (messages.added > 0) {
		console.log(`  ${C.dim}+${messages.added} message(s)${C.reset}`);
	}

	return 0;
}
