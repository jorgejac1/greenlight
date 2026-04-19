import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getBudgetSummary, getTotalTokens, reportTokenUsage } from "../budget.js";
import { getLastFailure, queryRuns } from "../log.js";
import { detectPatterns, exportSnapshot, suggest } from "../memory.js";
import { listMessages, sendMessage } from "../messages.js";
import { parseTodo } from "../parser.js";
import type { Contract, MessageKind, RunResult } from "../types.js";
import { runContract } from "../verifier.js";
import { updateTodo } from "../writer.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type Params = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function resolveTodoPath(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): string {
	if (typeof params.workspace === "string" && params.workspace.trim()) {
		const mapped = workspaces[params.workspace.trim()];
		if (!mapped) throw new Error(`unknown workspace: "${params.workspace}"`);
		return mapped;
	}
	const p = typeof params.path === "string" && params.path.trim() ? params.path.trim() : "todo.md";
	return resolve(serverCwd, p);
}

export function handleListWorkspaces(workspaces: Record<string, string>): unknown {
	const entries = Object.entries(workspaces).map(([name, path]) => ({ name, path }));
	return { count: entries.length, workspaces: entries };
}

function loadContracts(
	todoPath: string,
): { source: string; contracts: Contract[] } | { error: string } {
	if (!existsSync(todoPath)) {
		return { error: `todo.md not found: ${todoPath}` };
	}
	const source = readFileSync(todoPath, "utf8");
	return { source, contracts: parseTodo(source) };
}

function findContract(contracts: Contract[], contractId: string): Contract | undefined {
	const normalized = contractId.trim().toLowerCase();
	return contracts.find((c) => c.id === normalized || c.title.toLowerCase() === normalized);
}

function formatResult(result: RunResult): Record<string, unknown> {
	return {
		id: result.contract.id,
		title: result.contract.title,
		passed: result.passed,
		exitCode: result.exitCode,
		durationMs: result.durationMs,
		stdout: result.stdout.slice(0, 4000),
		stderr: result.stderr.slice(0, 4000),
	};
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleListTriggers(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	const triggered = loaded.contracts.filter((c) => c.trigger);
	return {
		count: triggered.length,
		contracts: triggered.map((c) => ({
			id: c.id,
			title: c.title,
			checked: c.checked,
			trigger: c.trigger,
			verifier: c.verifier?.kind === "shell" ? c.verifier.command : c.verifier ? "composite" : null,
		})),
	};
}

export async function handleListAll(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	return {
		count: loaded.contracts.length,
		contracts: loaded.contracts.map((c) => ({
			id: c.id,
			title: c.title,
			status: c.checked ? "done" : c.verifier ? "pending" : "ungated",
			verifier: c.verifier?.kind === "shell" ? c.verifier.command : c.verifier ? "composite" : null,
			retries: c.retries,
			budget: c.budget,
		})),
	};
}

export async function handleListPending(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	const pending = loaded.contracts.filter((c) => !c.checked && c.verifier);
	return {
		count: pending.length,
		contracts: pending.map((c) => ({
			id: c.id,
			title: c.title,
			verifier: c.verifier?.kind === "shell" ? c.verifier.command : "composite",
			retries: c.retries,
			budget: c.budget,
		})),
	};
}

export async function handleRunEval(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const contractId = params.contract_id;
	if (typeof contractId !== "string" || !contractId.trim()) {
		return { error: "contract_id is required" };
	}
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	const contract = findContract(loaded.contracts, contractId);
	if (!contract) return { error: `contract not found: ${contractId}` };
	if (!contract.verifier) return { error: `contract '${contractId}' has no verifier` };

	const cwd = resolve(dirname(todoPath));
	const result = await runContract(contract, cwd, { todoPath, trigger: "mcp" });

	if (result.passed) {
		const updated = updateTodo(loaded.source, [result]);
		if (updated !== loaded.source) writeFileSync(todoPath, updated);
	}

	return formatResult(result);
}

export async function handleCheckAll(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	const pending = loaded.contracts.filter((c) => !c.checked && c.verifier);
	if (pending.length === 0) return { count: 0, results: [] };

	const cwd = resolve(dirname(todoPath));
	const results: RunResult[] = [];
	for (const contract of pending) {
		results.push(await runContract(contract, cwd, { todoPath, trigger: "mcp" }));
	}

	const updated = updateTodo(loaded.source, results);
	if (updated !== loaded.source) writeFileSync(todoPath, updated);

	return {
		count: results.length,
		passed: results.filter((r) => r.passed).length,
		failed: results.filter((r) => !r.passed).length,
		results: results.map(formatResult),
	};
}

export async function handleGetRetryContext(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const contractId = params.contract_id;
	if (typeof contractId !== "string" || !contractId.trim()) {
		return { error: "contract_id is required" };
	}
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	const contract = findContract(loaded.contracts, contractId);
	if (!contract) return { error: `contract not found: ${contractId}` };
	if (!contract.verifier) return { error: `contract '${contractId}' has no verifier` };

	const cwd = resolve(dirname(todoPath));
	const result = await runContract(contract, cwd, { todoPath, trigger: "retry" });

	if (result.passed) {
		return { message: `Contract '${contract.title}' now passes — no retry needed.`, passed: true };
	}

	const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
	return {
		passed: false,
		context: [
			`Contract: ${contract.title} (${contract.id})`,
			`Verifier: ${contract.verifier.kind === "shell" ? contract.verifier.command : "composite"}`,
			`Exit code: ${result.exitCode}`,
			`Duration: ${result.durationMs}ms`,
			"",
			"--- Failure output ---",
			combined || "(no output)",
		].join("\n"),
	};
}

export async function handleGetRunHistory(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const contractId = typeof params.contract_id === "string" ? params.contract_id : undefined;
	const failedOnly = params.failed_only === true;
	const limit = typeof params.limit === "number" ? params.limit : 20;

	const records = queryRuns(todoPath, {
		contractId,
		passed: failedOnly ? false : undefined,
		limit,
	});

	return { count: records.length, records };
}

export async function handleGetLastFailure(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const contractId = params.contract_id;
	if (typeof contractId !== "string" || !contractId.trim()) {
		return { error: "contract_id is required" };
	}
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const record = getLastFailure(todoPath, contractId.trim());
	return record ?? { error: `no failure records found for: ${contractId}` };
}

const VALID_MESSAGE_KINDS = new Set([
	"completion",
	"blocker",
	"review_request",
	"status_update",
	"retry_request",
	"budget_exceeded",
]);

export async function handleSendMessage(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const from = typeof params.from === "string" ? params.from : undefined;
	const to = typeof params.to === "string" ? params.to : undefined;
	const kind = typeof params.kind === "string" ? params.kind : undefined;
	const contract_id = typeof params.contract_id === "string" ? params.contract_id : undefined;
	const correlation_id =
		typeof params.correlation_id === "string" ? params.correlation_id : undefined;

	if (!from || !to || !kind) return { error: "from, to, and kind are required" };
	if (!VALID_MESSAGE_KINDS.has(kind)) {
		return {
			error: `invalid kind: "${kind}". Must be one of: ${[...VALID_MESSAGE_KINDS].join(", ")}`,
		};
	}
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	let payload: unknown = null;
	if (typeof params.payload === "string") {
		try {
			payload = JSON.parse(params.payload);
		} catch {
			payload = params.payload;
		}
	} else if (params.payload !== undefined) {
		payload = params.payload;
	}
	return sendMessage(todoPath, {
		from,
		to,
		kind: kind as MessageKind,
		payload,
		contractId: contract_id,
		correlationId: correlation_id,
	});
}

export async function handleListMessages(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const to = typeof params.to === "string" ? params.to : undefined;
	const kind = typeof params.kind === "string" ? params.kind : undefined;
	const limit = typeof params.limit === "number" ? params.limit : 20;

	const messages = listMessages(todoPath, { to, kind: kind as MessageKind | undefined, limit });
	return { count: messages.length, messages };
}

export async function handleGetProviderHints(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	const summary = getBudgetSummary(todoPath, loaded.contracts);
	const usageById = new Map(summary.map((s) => [s.contractId, s]));

	return {
		count: loaded.contracts.length,
		contracts: loaded.contracts.map((c) => {
			const usage = usageById.get(c.id);
			return {
				id: c.id,
				title: c.title,
				status: c.checked ? "done" : c.verifier ? "pending" : "ungated",
				provider: c.provider ?? null,
				role: c.role ?? null,
				mcpServers: c.mcpServers ?? null,
				budget: c.budget ?? null,
				tokensUsed: usage?.used ?? 0,
				budgetExceeded: usage?.exceeded ?? false,
			};
		}),
	};
}

export async function handleReportTokenUsage(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const contractId = params.contract_id;
	const tokens = params.tokens;

	if (typeof contractId !== "string" || !contractId.trim()) {
		return { error: "contract_id is required" };
	}
	if (typeof tokens !== "number" || tokens < 0) {
		return { error: "tokens must be a non-negative number" };
	}

	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const loaded = loadContracts(todoPath);
	if ("error" in loaded) return { error: loaded.error };

	const contract = findContract(loaded.contracts, contractId);
	const record = reportTokenUsage(todoPath, contractId, tokens, contract);
	const total = getTotalTokens(todoPath, contractId);

	return {
		recorded: record,
		totalTokens: total,
		budget: contract?.budget ?? null,
		budgetExceeded: contract?.budget !== undefined && total > contract.budget,
	};
}

export async function handleSuggestTemplate(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const query = params.query;
	if (typeof query !== "string" || !query.trim()) return { error: "query is required" };
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const limit = typeof params.limit === "number" ? params.limit : 5;
	const results = suggest(todoPath, query.trim(), limit);
	return { query, count: results.length, suggestions: results };
}

export async function handleGetPatterns(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	const patterns = detectPatterns(todoPath);
	return { count: patterns.length, patterns };
}

export async function handleExportState(
	params: Params,
	serverCwd: string,
	workspaces: Record<string, string>,
): Promise<unknown> {
	const todoPath = resolveTodoPath(params, serverCwd, workspaces);
	return exportSnapshot(todoPath);
}
