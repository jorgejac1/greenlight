/**
 * evalgate budget tracking — v3.1
 *
 * SQLite-backed persistent budget log at .evalgate/budget.db.
 * Replaces the append-only NDJSON approach from v0.6.
 * Includes one-time migration from budget.ndjson → SQLite on first open.
 * Zero runtime dependencies beyond node:sqlite (Node 22+).
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { logDir } from "./log.js";
import { sendMessage } from "./messages.js";
import { swarmEvents } from "./swarm.js";
import type { BudgetExceededEvent, BudgetRecord, Contract, CostEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function budgetPath(todoPath: string): string {
	return join(logDir(todoPath), "budget.ndjson");
}

function budgetDbPath(todoPath: string): string {
	return join(logDir(todoPath), "budget.db");
}

function ensureDir(todoPath: string): void {
	const dir = logDir(todoPath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// DB connection management
// ---------------------------------------------------------------------------

const _dbs = new Map<string, DatabaseSync>();

function openFreshDb(dbPath: string, todoPath: string): DatabaseSync {
	const db = new DatabaseSync(dbPath);
	db.exec(`
		CREATE TABLE IF NOT EXISTS budget (
			id           TEXT PRIMARY KEY,
			ts           TEXT NOT NULL,
			contractId   TEXT NOT NULL,
			tokens       INTEGER NOT NULL,
			inputTokens  INTEGER,
			outputTokens INTEGER,
			workerId     TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_budget_contractId ON budget(contractId);
		CREATE INDEX IF NOT EXISTS idx_budget_ts ON budget(ts DESC);
	`);

	// One-time NDJSON → SQLite migration
	const njPath = budgetPath(todoPath);
	if (existsSync(njPath)) {
		const insert = db.prepare(
			"INSERT OR IGNORE INTO budget (id,ts,contractId,tokens,inputTokens,outputTokens,workerId) VALUES (?,?,?,?,?,?,?)",
		);
		try {
			const raw = readFileSync(njPath, "utf8");
			for (const line of raw.split("\n").filter(Boolean)) {
				try {
					const r = JSON.parse(line) as BudgetRecord;
					insert.run(
						r.id,
						r.ts,
						r.contractId,
						r.tokens,
						r.inputTokens ?? null,
						r.outputTokens ?? null,
						r.workerId ?? null,
					);
				} catch {
					/* skip malformed line */
				}
			}
		} catch {
			/* file unreadable — skip migration */
		}
		try {
			renameSync(njPath, `${njPath}.migrated`);
		} catch {
			/* best effort */
		}
	}

	return db;
}

function getDb(todoPath: string): DatabaseSync {
	const dbPath = budgetDbPath(todoPath);
	const cached = _dbs.get(dbPath);
	if (cached) {
		if (!existsSync(dbPath)) {
			_dbs.delete(dbPath);
		} else {
			return cached;
		}
	}
	ensureDir(todoPath);
	const db = openFreshDb(dbPath, todoPath);
	_dbs.set(dbPath, db);
	return db;
}

/** Exposed for compactLogs to reach the budget DB without duplicating path logic. */
export function getBudgetDb(todoPath: string): DatabaseSync {
	return getDb(todoPath);
}

// ---------------------------------------------------------------------------
// Cost estimation — exported so consumers (e.g. conductor) avoid hardcoding rates
// ---------------------------------------------------------------------------

const PRICING = {
	sonnet4: { input: 3, output: 15 },
	haiku4: { input: 0.8, output: 4 },
	opus4: { input: 15, output: 75 },
} as const;

/**
 * Estimate cost in USD given token counts and optional model.
 * Defaults to Sonnet 4 rates ($3/$15 per MTok in/out).
 */
export function estimateUsd(
	inputTokens: number,
	outputTokens: number,
	model: keyof typeof PRICING = "sonnet4",
): number {
	const { input, output } = PRICING[model];
	return (inputTokens * input + outputTokens * output) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function reportTokenUsage(
	todoPath: string,
	contractId: string,
	tokens: number,
	contract?: Contract,
	opts?: { inputTokens?: number; outputTokens?: number; workerId?: string },
): BudgetRecord {
	const record: BudgetRecord = {
		id: randomUUID(),
		ts: new Date().toISOString(),
		contractId,
		tokens,
		inputTokens: opts?.inputTokens,
		outputTokens: opts?.outputTokens,
		workerId: opts?.workerId,
	};

	const db = getDb(todoPath);
	db.prepare(
		"INSERT INTO budget (id,ts,contractId,tokens,inputTokens,outputTokens,workerId) VALUES (?,?,?,?,?,?,?)",
	).run(
		record.id,
		record.ts,
		record.contractId,
		record.tokens,
		record.inputTokens ?? null,
		record.outputTokens ?? null,
		record.workerId ?? null,
	);

	const inputTok = opts?.inputTokens ?? 0;
	const outputTok = opts?.outputTokens ?? 0;
	const estimatedUsd = estimateUsd(inputTok, outputTok);

	swarmEvents.emit("cost", {
		type: "cost",
		workerId: opts?.workerId ?? "",
		contractId,
		tokens: { input: inputTok, output: outputTok },
		estimatedUsd,
	} satisfies CostEvent);

	if (contract?.budget) {
		const total = getTotalTokens(todoPath, contractId);
		if (total > contract.budget) {
			sendMessage(todoPath, {
				from: "evalgate",
				to: "*",
				kind: "budget_exceeded",
				contractId,
				payload: {
					contractTitle: contract.title,
					budgetTokens: contract.budget,
					usedTokens: total,
					overBy: total - contract.budget,
				},
			});
			swarmEvents.emit("budget-exceeded", {
				type: "budget-exceeded",
				todoPath,
				contractId,
				totalTokens: total,
				estimatedUsd: estimateUsd(total, 0),
				budget: contract.budget,
			} satisfies BudgetExceededEvent);
		}
	}

	return record;
}

// ---------------------------------------------------------------------------
// Read + aggregate
// ---------------------------------------------------------------------------

type BudgetRow = {
	id: string;
	ts: string;
	contractId: string;
	tokens: number;
	inputTokens: number | null;
	outputTokens: number | null;
	workerId: string | null;
};

export function queryBudgetRecords(todoPath: string, contractId?: string): BudgetRecord[] {
	const dbPath = budgetDbPath(todoPath);
	if (!existsSync(dbPath) && !existsSync(budgetPath(todoPath))) return [];

	const db = getDb(todoPath);
	const rows =
		contractId !== undefined
			? (db
					.prepare("SELECT * FROM budget WHERE contractId = ? ORDER BY ts ASC")
					.all(contractId) as BudgetRow[])
			: (db.prepare("SELECT * FROM budget ORDER BY ts ASC").all() as BudgetRow[]);

	return rows.map((r) => ({
		id: r.id,
		ts: r.ts,
		contractId: r.contractId,
		tokens: r.tokens,
		inputTokens: r.inputTokens ?? undefined,
		outputTokens: r.outputTokens ?? undefined,
		workerId: r.workerId ?? undefined,
	}));
}

export function getTotalTokens(todoPath: string, contractId: string): number {
	const dbPath = budgetDbPath(todoPath);
	if (!existsSync(dbPath) && !existsSync(budgetPath(todoPath))) return 0;

	const db = getDb(todoPath);
	const row = db
		.prepare("SELECT COALESCE(SUM(tokens),0) as total FROM budget WHERE contractId = ?")
		.get(contractId) as { total: number };
	return row.total;
}

/** Per-contract budget summary for all contracts. */
export function getBudgetSummary(
	todoPath: string,
	contracts: Contract[],
): Array<{
	contractId: string;
	contractTitle: string;
	budget: number | undefined;
	used: number;
	remaining: number | undefined;
	exceeded: boolean;
}> {
	const dbPath = budgetDbPath(todoPath);
	if (!existsSync(dbPath) && !existsSync(budgetPath(todoPath))) {
		return contracts.map((c) => ({
			contractId: c.id,
			contractTitle: c.title,
			budget: c.budget,
			used: 0,
			remaining: c.budget,
			exceeded: false,
		}));
	}

	const db = getDb(todoPath);
	const rows = db
		.prepare("SELECT contractId, COALESCE(SUM(tokens),0) as used FROM budget GROUP BY contractId")
		.all() as Array<{ contractId: string; used: number }>;

	const usageMap = new Map(rows.map((r) => [r.contractId, r.used]));

	return contracts.map((c) => {
		const used = usageMap.get(c.id) ?? 0;
		const remaining = c.budget !== undefined ? c.budget - used : undefined;
		return {
			contractId: c.id,
			contractTitle: c.title,
			budget: c.budget,
			used,
			remaining,
			exceeded: c.budget !== undefined && used > c.budget,
		};
	});
}
