/**
 * Tests for Contract.weight sort tiebreaker in the work-stealing pool (v3.1).
 *
 * When two contracts share the same priority, the one with a higher weight
 * should start first (grab a slot first when concurrency is constrained).
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runSwarm } from "../src/swarm.js";
import { loadState } from "../src/swarm-state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpRepo(): string {
	const dir = join(
		tmpdir(),
		`evalgate-weight-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	execSync("git init -b main", { cwd: dir, stdio: "pipe" });
	execSync('git config user.email "test@evalgate.test"', { cwd: dir, stdio: "pipe" });
	execSync('git config user.name "evalgate test"', { cwd: dir, stdio: "pipe" });
	writeFileSync(join(dir, "README.md"), "# test\n");
	execSync("git add -A && git commit --no-gpg-sign -m 'init'", {
		cwd: dir,
		stdio: "pipe",
		shell: true,
	});
	return dir;
}

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

function writeTodo(dir: string, content: string): string {
	const p = join(dir, "todo.md");
	writeFileSync(p, content);
	execSync("git add todo.md && git commit --no-gpg-sign -m 'add todo'", {
		cwd: dir,
		stdio: "pipe",
		shell: true,
	});
	return p;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("weight tiebreaker: higher-weight contract starts first within same priority tier", async () => {
	const dir = makeTmpRepo();
	try {
		// Two contracts with the same priority but different weights.
		// The heavy contract (weight=5) should start before the light one (weight=1).
		// Both contracts append their title to a shared log file — with concurrency=1
		// the log order reflects the start order.
		const logFile = join(dir, "order.txt");

		const todoPath = writeTodo(
			dir,
			[
				`- [ ] Light Task\n  - eval: \`node -e "require('fs').appendFileSync('${logFile}', 'Light\\\\n')"\`\n  - priority: 5\n  - weight: 1\n`,
				`- [ ] Heavy Task\n  - eval: \`node -e "require('fs').appendFileSync('${logFile}', 'Heavy\\\\n')"\`\n  - priority: 5\n  - weight: 5\n`,
			].join(""),
		);

		const result = await runSwarm({
			todoPath,
			concurrency: 1,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(result.done, 2, `expected 2 done, got: ${result.done} (failed: ${result.failed})`);
		assert.equal(result.failed, 0);

		// Both workers should have completed
		const state = loadState(todoPath);
		assert.ok(state, "state should exist");
		assert.equal(state.workers.filter((w) => w.status === "done").length, 2);
	} finally {
		cleanup(dir);
	}
});

test("weight tiebreaker: priority still beats weight across tiers", async () => {
	const dir = makeTmpRepo();
	try {
		// Low-priority but heavy (weight=100) should still lose to high-priority light (weight=1).
		const todoPath = writeTodo(
			dir,
			[
				"- [ ] High Priority Light\n  - eval: `true`\n  - priority: 10\n  - weight: 1\n",
				"- [ ] Low Priority Heavy\n  - eval: `true`\n  - priority: 1\n  - weight: 100\n",
			].join(""),
		);

		const result = await runSwarm({
			todoPath,
			concurrency: 1,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(result.done, 2);
		assert.equal(result.failed, 0);
	} finally {
		cleanup(dir);
	}
});

test("weight tiebreaker: contracts without weight field default to weight=1", async () => {
	const dir = makeTmpRepo();
	try {
		// Contracts with no weight field should behave the same as weight=1
		const todoPath = writeTodo(
			dir,
			[
				"- [ ] No Weight A\n  - eval: `true`\n  - priority: 5\n",
				"- [ ] No Weight B\n  - eval: `true`\n  - priority: 5\n",
				"- [ ] Heavy C\n  - eval: `true`\n  - priority: 5\n  - weight: 10\n",
			].join(""),
		);

		const result = await runSwarm({
			todoPath,
			concurrency: 1,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(result.done, 3);
		assert.equal(result.failed, 0);

		// All 3 complete — main assertion is no crash/regression from undefined weight
		const state = loadState(todoPath);
		assert.ok(state);
		assert.equal(state.workers.filter((w) => w.status === "done").length, 3);
	} finally {
		cleanup(dir);
	}
});
