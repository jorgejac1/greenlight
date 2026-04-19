import { existsSync } from "node:fs";
import { exportSnapshot, snapshotToMarkdown } from "../memory.js";
import { C } from "./helpers.js";

export async function cmdExport(todoPath: string, format: "json" | "md"): Promise<number> {
	if (!existsSync(todoPath)) {
		console.error(`${C.red}evalgate: file not found: ${todoPath}${C.reset}`);
		return 1;
	}

	const snapshot = exportSnapshot(todoPath);

	if (format === "md") {
		process.stdout.write(`${snapshotToMarkdown(snapshot)}\n`);
	} else {
		process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
	}
	return 0;
}
