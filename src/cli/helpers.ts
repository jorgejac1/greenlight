import type { RunResult } from "../types.js";

export const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
export const C = {
	reset: COLOR ? "\x1b[0m" : "",
	red: COLOR ? "\x1b[31m" : "",
	green: COLOR ? "\x1b[32m" : "",
	yellow: COLOR ? "\x1b[33m" : "",
	cyan: COLOR ? "\x1b[36m" : "",
	bold: COLOR ? "\x1b[1m" : "",
	dim: COLOR ? "\x1b[2m" : "",
};

export function formatCommand(v: RunResult["contract"]["verifier"]): string {
	if (!v) return "no verifier";
	if (v.kind === "shell") return v.command;
	if (v.kind === "composite") return `${v.mode}(${v.steps.length} steps)`;
	if (v.kind === "llm") return `llm: ${v.prompt.slice(0, 60)}`;
	if (v.kind === "diff") return `diff: ${v.file} ${v.mode} "${v.pattern}"`;
	return "unknown";
}

export function looksLikeFailure(s: string): boolean {
	return /\b(error|fail(ed)?|expected|assertion|✖|✗|throws?)\b/i.test(s);
}

export function buildBar(used: number, budget: number, width: number): string {
	const pct = Math.min(1, used / budget);
	const filled = Math.round(pct * width);
	const empty = width - filled;
	const color = pct >= 1 ? C.red : pct >= 0.8 ? C.yellow : C.green;
	return color + "█".repeat(filled) + C.dim + "░".repeat(empty) + C.reset;
}
