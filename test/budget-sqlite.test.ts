/**
 * Tests for the SQLite-backed budget log (v3.1).
 *
 * - Open/migrate idempotent: budget.ndjson → budget.db migration runs once
 * - Query parity: same records visible before and after migration
 * - Public API signature unchanged: reportTokenUsage, queryBudgetRecords, getBudgetSummary, getTotalTokens
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	getBudgetSummary,
	getTotalTokens,
	queryBudgetRecords,
	reportTokenUsage,
} from "../src/budget.js";
import { logDir } from "../src/log.js";
import type { BudgetRecord } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
	const dir = mkdtempSync(join(tmpdir(), "gl-budget-sqlite-test-"));
	writeFileSync(join(dir, "todo.md"), "- [ ] test\n  - eval: `echo ok`\n");
	return dir;
}

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

function makeLegacyRecord(id: string, contractId: string, tokens: number): BudgetRecord {
	return {
		id,
		ts: new Date().toISOString(),
		contractId,
		tokens,
		inputTokens: Math.floor(tokens * 0.6),
		outputTokens: Math.floor(tokens * 0.4),
		workerId: "worker-legacy",
	};
}

// ---------------------------------------------------------------------------
// Tests: basic write + read
// ---------------------------------------------------------------------------

describe("budget-sqlite: reportTokenUsage + queryBudgetRecords", () => {
	it("writes a record and reads it back from SQLite", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			reportTokenUsage(path, "contract-a", 1000, undefined, {
				inputTokens: 600,
				outputTokens: 400,
				workerId: "worker-1",
			});

			const records = queryBudgetRecords(path, "contract-a");
			assert.equal(records.length, 1);
			assert.equal(records[0].contractId, "contract-a");
			assert.equal(records[0].tokens, 1000);
			assert.equal(records[0].inputTokens, 600);
			assert.equal(records[0].outputTokens, 400);
			assert.equal(records[0].workerId, "worker-1");
		} finally {
			cleanup(dir);
		}
	});

	it("returns empty array when no records exist", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			const records = queryBudgetRecords(path, "nonexistent");
			assert.equal(records.length, 0);
		} finally {
			cleanup(dir);
		}
	});

	it("isolates records by contractId", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			reportTokenUsage(path, "contract-a", 100);
			reportTokenUsage(path, "contract-b", 200);
			reportTokenUsage(path, "contract-a", 300);

			const a = queryBudgetRecords(path, "contract-a");
			const b = queryBudgetRecords(path, "contract-b");

			assert.equal(a.length, 2);
			assert.equal(b.length, 1);
			assert.equal(b[0].tokens, 200);
		} finally {
			cleanup(dir);
		}
	});

	it("stores records without optional fields (undefined inputTokens/outputTokens/workerId)", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			const record = reportTokenUsage(path, "contract-bare", 500);

			assert.equal(record.tokens, 500);
			assert.equal(record.inputTokens, undefined);
			assert.equal(record.outputTokens, undefined);
			assert.equal(record.workerId, undefined);

			const fetched = queryBudgetRecords(path, "contract-bare");
			assert.equal(fetched.length, 1);
			// SQLite stores NULL as undefined after mapping
			assert.ok(
				fetched[0].inputTokens === undefined || fetched[0].inputTokens === null,
				"inputTokens should be nullish",
			);
		} finally {
			cleanup(dir);
		}
	});
});

// ---------------------------------------------------------------------------
// Tests: getTotalTokens
// ---------------------------------------------------------------------------

describe("budget-sqlite: getTotalTokens", () => {
	it("returns 0 when no records exist", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			assert.equal(getTotalTokens(path, "missing"), 0);
		} finally {
			cleanup(dir);
		}
	});

	it("sums tokens across multiple records for the same contract", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			reportTokenUsage(path, "contract-sum", 100);
			reportTokenUsage(path, "contract-sum", 200);
			reportTokenUsage(path, "contract-sum", 300);

			assert.equal(getTotalTokens(path, "contract-sum"), 600);
		} finally {
			cleanup(dir);
		}
	});

	it("does not include tokens from other contracts", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			reportTokenUsage(path, "contract-x", 1000);
			reportTokenUsage(path, "contract-y", 9999);

			assert.equal(getTotalTokens(path, "contract-x"), 1000);
		} finally {
			cleanup(dir);
		}
	});
});

// ---------------------------------------------------------------------------
// Tests: getBudgetSummary
// ---------------------------------------------------------------------------

describe("budget-sqlite: getBudgetSummary", () => {
	it("returns one entry per contract with summed tokens", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			reportTokenUsage(path, "c1", 500);
			reportTokenUsage(path, "c1", 500);
			reportTokenUsage(path, "c2", 200);

			const contracts = [
				{
					id: "c1",
					title: "Contract 1",
					verifier: { kind: "shell" as const, command: "true" },
				},
				{
					id: "c2",
					title: "Contract 2",
					verifier: { kind: "shell" as const, command: "true" },
				},
			];
			const summary = getBudgetSummary(path, contracts);

			const c1 = summary.find((s) => s.contractId === "c1");
			const c2 = summary.find((s) => s.contractId === "c2");

			assert.ok(c1, "c1 should be in summary");
			assert.equal(c1.used, 1000);
			assert.ok(c2, "c2 should be in summary");
			assert.equal(c2.used, 200);
		} finally {
			cleanup(dir);
		}
	});

	it("returns zero usage for contract with no records", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			const contracts = [
				{
					id: "never-run",
					title: "Never run",
					verifier: { kind: "shell" as const, command: "true" },
				},
			];
			const summary = getBudgetSummary(path, contracts);
			const entry = summary.find((s) => s.contractId === "never-run");
			assert.ok(entry, "should include entry for contract with no records");
			assert.equal(entry.used, 0);
		} finally {
			cleanup(dir);
		}
	});
});

// ---------------------------------------------------------------------------
// Tests: NDJSON migration
// ---------------------------------------------------------------------------

describe("budget-sqlite: NDJSON migration", () => {
	it("migrates budget.ndjson to SQLite on first DB open", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			const evalDir = logDir(path);
			mkdirSync(evalDir, { recursive: true });

			const legacy: BudgetRecord[] = [
				makeLegacyRecord("legacy-1", "contract-m", 1000),
				makeLegacyRecord("legacy-2", "contract-m", 2000),
			];
			const ndjsonFile = join(evalDir, "budget.ndjson");
			writeFileSync(ndjsonFile, legacy.map((r) => JSON.stringify(r)).join("\n") + "\n");

			// First write triggers DB open + migration
			reportTokenUsage(path, "contract-m", 500);

			const records = queryBudgetRecords(path, "contract-m");
			assert.ok(records.length >= 3, `expected at least 3 records, got ${records.length}`);

			const ids = new Set(records.map((r) => r.id));
			assert.ok(ids.has("legacy-1"), "legacy-1 should be migrated");
			assert.ok(ids.has("legacy-2"), "legacy-2 should be migrated");

			// NDJSON should be renamed
			assert.ok(!existsSync(ndjsonFile), "budget.ndjson should be renamed after migration");
			assert.ok(existsSync(`${ndjsonFile}.migrated`), "budget.ndjson.migrated should exist");
		} finally {
			cleanup(dir);
		}
	});

	it("migration is idempotent — second open with migrated file skips re-migration", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			const evalDir = logDir(path);
			mkdirSync(evalDir, { recursive: true });

			const ndjsonFile = join(evalDir, "budget.ndjson");
			writeFileSync(
				ndjsonFile,
				JSON.stringify(makeLegacyRecord("idem-1", "contract-idem", 100)) + "\n",
			);

			// First open — migrates
			reportTokenUsage(path, "contract-idem", 50);
			const afterFirst = queryBudgetRecords(path, "contract-idem");
			const countAfterFirst = afterFirst.length;

			// Second write — DB already open, no re-migration
			reportTokenUsage(path, "contract-idem", 75);
			const afterSecond = queryBudgetRecords(path, "contract-idem");

			// Should have exactly one more record (the 75-token write), not duplicates of legacy
			assert.equal(afterSecond.length, countAfterFirst + 1);
		} finally {
			cleanup(dir);
		}
	});

	it("handles malformed NDJSON lines during migration without throwing", () => {
		const dir = makeTmp();
		try {
			const path = join(dir, "todo.md");
			const evalDir = logDir(path);
			mkdirSync(evalDir, { recursive: true });

			const ndjsonFile = join(evalDir, "budget.ndjson");
			writeFileSync(
				ndjsonFile,
				JSON.stringify(makeLegacyRecord("good-1", "contract-mal", 100)) +
					"\n" +
					"{ not valid json }\n" +
					JSON.stringify(makeLegacyRecord("good-2", "contract-mal", 200)) +
					"\n",
			);

			// Should not throw
			reportTokenUsage(path, "contract-mal", 50);

			const records = queryBudgetRecords(path, "contract-mal");
			const ids = new Set(records.map((r) => r.id));
			assert.ok(ids.has("good-1"), "good-1 should be migrated despite malformed line");
			assert.ok(ids.has("good-2"), "good-2 should be migrated despite malformed line");
		} finally {
			cleanup(dir);
		}
	});
});
