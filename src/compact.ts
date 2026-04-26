/**
 * evalgate log compaction — v3.1
 *
 * Prunes old records from runs.db and budget.db for a given todoPath.
 * Separated from log.ts to avoid a circular import (budget.ts → log.ts → budget.ts).
 *
 * WARNING: Deleted rows are not recoverable. Always run with dryRun=true first.
 * This is NOT called automatically — invoke via CLI or explicitly in scripts.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getBudgetDb } from "./budget.js";
import { getRunsDb, logDir, runsPath } from "./log.js";

export interface CompactOptions {
	/** Delete rows older than this many days. */
	maxAgeDays?: number;
	/** Keep only the newest N rows per contractId. */
	maxRows?: number;
	/**
	 * When true, report counts but make no changes.
	 * Always set dryRun explicitly when calling programmatically.
	 */
	dryRun?: boolean;
}

/**
 * Prune old records from runs.db and budget.db.
 * At least one of maxAgeDays or maxRows must be provided.
 */
export function compactLogs(
	todoPath: string,
	opts: CompactOptions,
): { runsDeleted: number; budgetDeleted: number } {
	const runsDb: DatabaseSync | null = existsSync(runsPath(todoPath)) ? getRunsDb(todoPath) : null;

	const budgetDbFile = join(logDir(todoPath), "budget.db");
	const budgetDb: DatabaseSync | null = existsSync(budgetDbFile) ? getBudgetDb(todoPath) : null;

	let runsDeleted = 0;
	let budgetDeleted = 0;

	const cutoff =
		opts.maxAgeDays !== undefined
			? new Date(Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
			: null;

	// -- age-based pruning --
	if (cutoff) {
		if (!opts.dryRun) {
			if (runsDb) {
				const r = runsDb.prepare("DELETE FROM runs WHERE ts < ?").run(cutoff) as {
					changes: number;
				};
				runsDeleted += r.changes;
			}
			if (budgetDb) {
				const r = budgetDb.prepare("DELETE FROM budget WHERE ts < ?").run(cutoff) as {
					changes: number;
				};
				budgetDeleted += r.changes;
			}
		} else {
			if (runsDb) {
				const r = runsDb.prepare("SELECT COUNT(*) as n FROM runs WHERE ts < ?").get(cutoff) as {
					n: number;
				};
				runsDeleted += r.n;
			}
			if (budgetDb) {
				const r = budgetDb.prepare("SELECT COUNT(*) as n FROM budget WHERE ts < ?").get(cutoff) as {
					n: number;
				};
				budgetDeleted += r.n;
			}
		}
	}

	// -- per-contract row-cap pruning --
	if (opts.maxRows !== undefined && opts.maxRows > 0) {
		const maxRows = opts.maxRows;

		if (runsDb) {
			const contracts = runsDb.prepare("SELECT DISTINCT contractId FROM runs").all() as Array<{
				contractId: string;
			}>;
			for (const { contractId } of contracts) {
				const total = (
					runsDb.prepare("SELECT COUNT(*) as n FROM runs WHERE contractId = ?").get(contractId) as {
						n: number;
					}
				).n;
				const excess = total - maxRows;
				if (excess > 0) {
					if (!opts.dryRun) {
						const r = runsDb
							.prepare(
								`DELETE FROM runs WHERE id IN (
									SELECT id FROM runs WHERE contractId = ? ORDER BY ts ASC LIMIT ?
								)`,
							)
							.run(contractId, excess) as { changes: number };
						runsDeleted += r.changes;
					} else {
						runsDeleted += excess;
					}
				}
			}
		}

		if (budgetDb) {
			const contracts = budgetDb.prepare("SELECT DISTINCT contractId FROM budget").all() as Array<{
				contractId: string;
			}>;
			for (const { contractId } of contracts) {
				const total = (
					budgetDb
						.prepare("SELECT COUNT(*) as n FROM budget WHERE contractId = ?")
						.get(contractId) as { n: number }
				).n;
				const excess = total - maxRows;
				if (excess > 0) {
					if (!opts.dryRun) {
						const r = budgetDb
							.prepare(
								`DELETE FROM budget WHERE id IN (
									SELECT id FROM budget WHERE contractId = ? ORDER BY ts ASC LIMIT ?
								)`,
							)
							.run(contractId, excess) as { changes: number };
						budgetDeleted += r.changes;
					} else {
						budgetDeleted += excess;
					}
				}
			}
		}
	}

	return { runsDeleted, budgetDeleted };
}
