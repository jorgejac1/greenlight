/**
 * Tests for src/swarm-state.ts
 *
 * Uses a real temporary directory — no mocking of fs operations.
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadState, saveState, updateWorker } from "../src/swarm-state.js";
import type { SwarmState, WorkerState } from "../src/types.js";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`evalgate-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

function fakeTodoPath(dir: string): string {
	return join(dir, "todo.md");
}

function fakeState(todoPath: string): SwarmState {
	return {
		id: "test-swarm-id",
		ts: new Date().toISOString(),
		todoPath,
		workers: [
			{
				id: "w1",
				contractId: "implement-add",
				contractTitle: "Implement add",
				worktreePath: "/tmp/wt-w1",
				branch: "evalgate/implement-add-w1",
				status: "pending",
				logPath: "/tmp/.evalgate/sessions/w1.log",
			},
		],
	};
}

test("loadState returns null when file does not exist", () => {
	const dir = makeTmpDir();
	try {
		const result = loadState(fakeTodoPath(dir));
		assert.equal(result, null);
	} finally {
		cleanup(dir);
	}
});

test("saveState + loadState round-trips the full state", () => {
	const dir = makeTmpDir();
	try {
		const todoPath = fakeTodoPath(dir);
		const state = fakeState(todoPath);
		saveState(todoPath, state);
		const loaded = loadState(todoPath);
		assert.ok(loaded !== null, "loaded state should not be null");
		assert.equal(loaded.id, state.id);
		assert.equal(loaded.todoPath, state.todoPath);
		assert.equal(loaded.workers.length, 1);
		assert.equal(loaded.workers[0]?.id, "w1");
		assert.equal(loaded.workers[0]?.status, "pending");
	} finally {
		cleanup(dir);
	}
});

test("saveState is atomic: reads back the new value after overwrite", () => {
	const dir = makeTmpDir();
	try {
		const todoPath = fakeTodoPath(dir);
		const state = fakeState(todoPath);
		saveState(todoPath, state);

		// Overwrite with different id
		const state2 = { ...state, id: "second-id" };
		saveState(todoPath, state2);

		const loaded = loadState(todoPath);
		assert.equal(loaded?.id, "second-id");
	} finally {
		cleanup(dir);
	}
});

test("updateWorker merges partial fields into the matching worker", () => {
	const dir = makeTmpDir();
	try {
		const todoPath = fakeTodoPath(dir);
		const state = fakeState(todoPath);
		saveState(todoPath, state);

		const startedAt = new Date().toISOString();
		updateWorker(todoPath, "w1", { status: "running", startedAt, pid: 12345 });

		const loaded = loadState(todoPath);
		const w = loaded?.workers[0];
		assert.equal(w?.status, "running");
		assert.equal(w?.startedAt, startedAt);
		assert.equal(w?.pid, 12345);
		// Unchanged fields should be preserved
		assert.equal(w?.contractTitle, "Implement add");
	} finally {
		cleanup(dir);
	}
});

test("updateWorker is a no-op when worker id is not found", () => {
	const dir = makeTmpDir();
	try {
		const todoPath = fakeTodoPath(dir);
		const state = fakeState(todoPath);
		saveState(todoPath, state);

		// This should not throw
		updateWorker(todoPath, "nonexistent-id", { status: "done" });

		const loaded = loadState(todoPath);
		// Original state should be unchanged
		assert.equal(loaded?.workers[0]?.status, "pending");
	} finally {
		cleanup(dir);
	}
});

test("updateWorker is a no-op when state file does not exist", () => {
	const dir = makeTmpDir();
	try {
		// Should not throw
		assert.doesNotThrow(() => {
			updateWorker(fakeTodoPath(dir), "w1", { status: "done" });
		});
	} finally {
		cleanup(dir);
	}
});

test("saveState creates .evalgate directory if missing", () => {
	const dir = makeTmpDir();
	try {
		const todoPath = fakeTodoPath(dir);
		// .evalgate does not exist yet — saveState should create it
		const state = fakeState(todoPath);
		saveState(todoPath, state);
		const loaded = loadState(todoPath);
		assert.ok(loaded !== null);
	} finally {
		cleanup(dir);
	}
});

test("WorkerState with all optional fields round-trips correctly", () => {
	const dir = makeTmpDir();
	try {
		const todoPath = fakeTodoPath(dir);
		const worker: WorkerState = {
			id: "w2",
			contractId: "test-contract",
			contractTitle: "Test contract",
			worktreePath: "/tmp/wt-w2",
			branch: "evalgate/test-contract-w2",
			status: "done",
			pid: 9999,
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: "2026-01-01T00:01:00.000Z",
			agentExitCode: 0,
			verifierPassed: true,
			logPath: "/tmp/.evalgate/sessions/w2.log",
		};
		const state: SwarmState = {
			id: "s2",
			ts: "2026-01-01T00:00:00.000Z",
			todoPath,
			workers: [worker],
		};
		saveState(todoPath, state);
		const loaded = loadState(todoPath);
		const lw = loaded?.workers[0];
		assert.equal(lw?.pid, 9999);
		assert.equal(lw?.verifierPassed, true);
		assert.equal(lw?.agentExitCode, 0);
	} finally {
		cleanup(dir);
	}
});
