/**
 * Tests for src/compact.ts (v3.1).
 *
 * - maxAgeDays: deletes only rows older than the cutoff
 * - maxRows: keeps newest N rows per contractId
 * - dryRun: reports counts without mutating anything
 * - Handles missing DB gracefully (no .db file = no-op)
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { compactLogs } from "../src/compact.js";
import { appendRun, getRunsDb, queryRuns } from "../src/log.js";
import type { Contract, RunResult } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
	const dir = mkdtempSync(join(tmpdir(), "gl-compact-test-"));
	writeFileSync(join(dir, "todo.md"), "- [ ] test\n  - eval: `echo ok`\n");
	return dir;
}

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

function makeResult(contractId: string, overrides: Partial<RunResult> = {}): RunResult {
	const contract: Contract = {
		id: contractId,
		title: `Contract ${contractId}`,
		checked: false,
		status: "pending",
		line: 0,
		rawLines: [0],
	};
	return {
		contract,
		passed: true,
		exitCode: 0,
		durationMs: 10,
		stdout: "",
		stderr: "",
		...overrides,
	};
}

/** Insert a run with a specific ISO timestamp directly via the shared DB connection. */
function insertWithTs(todoPath: string, id: string, contractId: string, ts: string): void {
	const db = getRunsDb(todoPath);
	db.prepare(
		"INSERT INTO runs (id, ts, contractId, contractTitle, trigger, passed, exitCode, durationMs, stdout, stderr) VALUES (?,?,?,?,?,?,?,?,?,?)",
	).run(id, ts, contractId, `Contract ${contractId}`, "manual", 1, 0, 10, "", "");
}

// ---------------------------------------------------------------------------
// Tests: no-op when DB file doesn't exist
// ---------------------------------------------------------------------------

describe("compactLogs: no-op when DB absent", () => {
	it("returns zeros when runs.db does not exist", () => {
		const dir = makeTmp();
		try {
			const result = compactLogs(join(dir, "todo.md"), { maxAgeDays: 90 });
			assert.equal(result.runsDeleted, 0);
			assert.equal(result.budgetDeleted, 0);
		} finally {
			cleanup(dir);
		}
	});
});

// ---------------------------------------------------------------------------
// Tests: maxAgeDays
// ---------------------------------------------------------------------------

describe("compactLogs: maxAgeDays pruning", () => {
	it("deletes rows older than the cutoff and keeps recent ones", () => {
		const dir = makeTmp();
		try {
			const todoPath = join(dir, "todo.md");

			// Seed with a recent record (creates DB)
			appendRun(makeResult("c1"), todoPath, "manual");
			// Insert an old record directly
			insertWithTs(todoPath, "old-record", "c1", "2000-01-01T00:00:00.000Z");

			const before = queryRuns(todoPath);
			assert.equal(before.length, 2);

			const result = compactLogs(todoPath, { maxAgeDays: 365 });
			assert.equal(result.runsDeleted, 1, "should delete the old record");

			const after = queryRuns(todoPath);
			assert.equal(after.length, 1);
			assert.ok(after[0].id !== "old-record");
		} finally {
			cleanup(dir);
		}
	});

	it("deletes nothing when all rows are recent", () => {
		const dir = makeTmp();
		try {
			const todoPath = join(dir, "todo.md");
			appendRun(makeResult("c1"), todoPath, "manual");
			appendRun(makeResult("c1"), todoPath, "manual");

			const result = compactLogs(todoPath, { maxAgeDays: 365 });
			assert.equal(result.runsDeleted, 0);
			assert.equal(queryRuns(todoPath).length, 2);
		} finally {
			cleanup(dir);
		}
	});

	it("dryRun=true reports count without deleting", () => {
		const dir = makeTmp();
		try {
			const todoPath = join(dir, "todo.md");

			appendRun(makeResult("c1"), todoPath, "manual");
			insertWithTs(todoPath, "old-dry", "c1", "2000-06-01T00:00:00.000Z");

			const result = compactLogs(todoPath, { maxAgeDays: 365, dryRun: true });
			assert.equal(result.runsDeleted, 1, "dryRun should report 1");

			// Nothing deleted
			assert.equal(queryRuns(todoPath).length, 2, "dryRun must not mutate");
		} finally {
			cleanup(dir);
		}
	});
});

// ---------------------------------------------------------------------------
// Tests: maxRows
// ---------------------------------------------------------------------------

describe("compactLogs: maxRows pruning", () => {
	it("keeps only the newest N rows per contract", async () => {
		const dir = makeTmp();
		try {
			const todoPath = join(dir, "todo.md");

			for (let i = 1; i <= 5; i++) {
				appendRun(makeResult("c1", { durationMs: i * 10 }), todoPath, "manual");
				await new Promise((r) => setTimeout(r, 5));
			}

			assert.equal(queryRuns(todoPath).length, 5);

			const result = compactLogs(todoPath, { maxRows: 3 });
			assert.equal(result.runsDeleted, 2);

			const after = queryRuns(todoPath);
			assert.equal(after.length, 3);

			// Newest 3 (50ms, 40ms, 30ms) should survive
			const durations = new Set(after.map((r) => r.durationMs));
			assert.ok(durations.has(50));
			assert.ok(durations.has(40));
			assert.ok(durations.has(30));
		} finally {
			cleanup(dir);
		}
	});

	it("does not delete when at or below maxRows", () => {
		const dir = makeTmp();
		try {
			const todoPath = join(dir, "todo.md");
			appendRun(makeResult("c1"), todoPath, "manual");
			appendRun(makeResult("c1"), todoPath, "manual");

			assert.equal(compactLogs(todoPath, { maxRows: 5 }).runsDeleted, 0);
		} finally {
			cleanup(dir);
		}
	});

	it("handles multiple contracts independently", async () => {
		const dir = makeTmp();
		try {
			const todoPath = join(dir, "todo.md");

			for (let i = 0; i < 4; i++) {
				appendRun(makeResult("c1"), todoPath, "manual");
				await new Promise((r) => setTimeout(r, 5));
			}
			for (let i = 0; i < 2; i++) {
				appendRun(makeResult("c2"), todoPath, "manual");
				await new Promise((r) => setTimeout(r, 5));
			}

			// c1 has 2 excess, c2 has none
			const result = compactLogs(todoPath, { maxRows: 2 });
			assert.equal(result.runsDeleted, 2);

			assert.equal(queryRuns(todoPath, { contractId: "c1" }).length, 2);
			assert.equal(queryRuns(todoPath, { contractId: "c2" }).length, 2);
		} finally {
			cleanup(dir);
		}
	});

	it("dryRun=true with maxRows reports without deleting", async () => {
		const dir = makeTmp();
		try {
			const todoPath = join(dir, "todo.md");

			for (let i = 0; i < 5; i++) {
				appendRun(makeResult("c1"), todoPath, "manual");
				await new Promise((r) => setTimeout(r, 5));
			}

			const result = compactLogs(todoPath, { maxRows: 2, dryRun: true });
			assert.equal(result.runsDeleted, 3);
			assert.equal(queryRuns(todoPath).length, 5, "dryRun must not mutate");
		} finally {
			cleanup(dir);
		}
	});
});
