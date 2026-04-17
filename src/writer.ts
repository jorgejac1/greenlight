import type { RunResult } from "./types.js";

/**
 * Apply RunResults back to the todo.md source. Only passed contracts
 * are flipped to [x]; failed contracts are left as-is (the CLI reports
 * failures separately so the agent can see them).
 */
export function updateTodo(source: string, results: RunResult[]): string {
	const lines = source.split("\n");
	for (const r of results) {
		if (!r.passed) continue;
		const idx = r.contract.line;
		if (idx < 0 || idx >= lines.length) continue;
		lines[idx] = lines[idx].replace(/\[ \]/, "[x]");
	}
	return lines.join("\n");
}
