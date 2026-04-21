/**
 * Integration tests for retryIf condition evaluation inside retryWorker (v2.2).
 *
 * Tests the two branching paths:
 *   1. retryIf condition IS met  → retry proceeds (full worker lifecycle runs)
 *   2. retryIf condition NOT met → returns immediately with failureKind "verifier-fail"
 *
 * Uses a real git repo + trivially-fast agent (node -e '...') so the suite
 * runs quickly. Helpers intentionally self-contained (not imported from other
 * test files).
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { retryWorker, runSwarm } from "../src/swarm.js";
import { saveState } from "../src/swarm-state.js";
import type { SwarmState } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test helpers (self-contained — not imported from other test files)
// ---------------------------------------------------------------------------

function makeTmpRepo(): string {
	const dir = join(
		tmpdir(),
		`evalgate-retry-if-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	execSync("git init -b main", { cwd: dir, stdio: "pipe" });
	execSync('git config user.email "test@evalgate.test"', { cwd: dir, stdio: "pipe" });
	execSync('git config user.name "evalgate test"', { cwd: dir, stdio: "pipe" });
	writeFileSync(join(dir, "README.md"), "# test repo\n");
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

test("retryWorker retryIf condition IS met — proceeds with retry and reaches terminal state", async () => {
	const dir = makeTmpRepo();
	try {
		// Agent exits 0 but verifier (`false`) fails.
		// retry-if: exit-code == 0 → condition IS met when agentExitCode is 0.
		const todoPath = writeTodo(
			dir,
			`${["- [ ] Retry if met", "  - eval: `false`", "  - retry-if: exit-code == 0"].join("\n")}\n`,
		);

		const firstRun = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.equal(firstRun.failed, 1, "initial run should produce one failed worker");

		const failedWorker = firstRun.state.workers.find((w) => w.status === "failed");
		assert.ok(failedWorker, "should have a failed worker to retry");
		// Confirm agentExitCode was recorded as 0 by spawnAgent.
		assert.equal(failedWorker.agentExitCode, 0, "agent exit code should be 0");

		// Update the todo so the verifier now passes (condition remains the same).
		writeFileSync(
			todoPath,
			`${["- [ ] Retry if met", "  - eval: `true`", "  - retry-if: exit-code == 0"].join("\n")}\n`,
		);
		execSync("git add todo.md && git commit --no-gpg-sign -m 'fix verifier'", {
			cwd: dir,
			stdio: "pipe",
			shell: true,
		});

		// Condition (exit-code == 0) IS met — retry should proceed.
		const finalWorker = await retryWorker(failedWorker.id, todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		// The retry ran the full lifecycle and verifier passed.
		assert.equal(finalWorker.status, "done", "worker should be done after successful retry");
		assert.equal(finalWorker.verifierPassed, true);
		assert.ok(finalWorker.finishedAt, "should have a finishedAt timestamp");
	} finally {
		cleanup(dir);
	}
});

test("retryWorker retryIf condition NOT met — returns immediately with failureKind verifier-fail", async () => {
	const dir = makeTmpRepo();
	try {
		// Agent exits 0, verifier (`false`) fails.
		// retry-if: exit-code > 1 → condition is NOT met when agentExitCode is 0.
		const todoPath = writeTodo(
			dir,
			["- [ ] Retry if not met", "  - eval: `false`", "  - retry-if: exit-code > 1"].join("\n") +
				"\n",
		);

		const firstRun = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.equal(firstRun.failed, 1, "initial run should produce one failed worker");

		const failedWorker = firstRun.state.workers.find((w) => w.status === "failed");
		assert.ok(failedWorker, "should have a failed worker to attempt retry on");
		assert.equal(failedWorker.agentExitCode, 0, "agent exit code should be 0");

		// condition (exit-code > 1) is NOT met when agentExitCode == 0 → skip retry.
		const finalWorker = await retryWorker(failedWorker.id, todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		// retryWorker returns immediately — no full lifecycle, no new worktree.
		assert.equal(
			finalWorker.status,
			"failed",
			"worker should remain failed when condition not met",
		);
		assert.equal(
			finalWorker.failureKind,
			"verifier-fail",
			"failureKind should be verifier-fail when condition not met",
		);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker retryIf with != operator — condition met when exit code differs", async () => {
	const dir = makeTmpRepo();
	try {
		// Agent exits 0; retry-if: exit-code != 1 → 0 != 1 is true → condition IS met.
		const todoPath = writeTodo(
			dir,
			`${["- [ ] Retry if != condition", "  - eval: `false`", "  - retry-if: exit-code != 1"].join(
				"\n",
			)}\n`,
		);

		const firstRun = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.equal(firstRun.failed, 1);

		const failedWorker = firstRun.state.workers.find((w) => w.status === "failed");
		assert.ok(failedWorker);

		// Fix the verifier so the retry can pass.
		writeFileSync(
			todoPath,
			`${["- [ ] Retry if != condition", "  - eval: `true`", "  - retry-if: exit-code != 1"].join(
				"\n",
			)}\n`,
		);
		execSync("git add todo.md && git commit --no-gpg-sign -m 'fix verifier'", {
			cwd: dir,
			stdio: "pipe",
			shell: true,
		});

		const finalWorker = await retryWorker(failedWorker.id, todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(
			finalWorker.status,
			"done",
			"worker should be done when != condition is met and verifier passes",
		);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker without retryIf always proceeds with retry (default behaviour)", async () => {
	const dir = makeTmpRepo();
	try {
		// No retry-if field — retryWorker must always proceed regardless of exit code.
		const todoPath = writeTodo(
			dir,
			`${["- [ ] Unconditional retry", "  - eval: `false`"].join("\n")}\n`,
		);

		const firstRun = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.equal(firstRun.failed, 1);

		const failedWorker = firstRun.state.workers.find((w) => w.status === "failed");
		assert.ok(failedWorker);

		// Fix the verifier.
		writeFileSync(todoPath, `${["- [ ] Unconditional retry", "  - eval: `true`"].join("\n")}\n`);
		execSync("git add todo.md && git commit --no-gpg-sign -m 'fix verifier'", {
			cwd: dir,
			stdio: "pipe",
			shell: true,
		});

		const finalWorker = await retryWorker(failedWorker.id, todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(
			finalWorker.status,
			"done",
			"worker without retryIf should always proceed to retry",
		);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker retryIf uses pre-built state — condition NOT met on manually set agentExitCode", async () => {
	const dir = makeTmpRepo();
	try {
		// Build state manually to set a specific agentExitCode without running a real swarm.
		const todoPath = writeTodo(
			dir,
			`${["- [ ] Manual exit code state", "  - eval: `true`", "  - retry-if: exit-code >= 5"].join(
				"\n",
			)}\n`,
		);

		mkdirSync(join(dir, ".evalgate", "sessions"), { recursive: true });

		// agentExitCode: 2 — condition (>= 5) is NOT met → retry should be skipped.
		const preState: SwarmState = {
			id: "retry-if-manual-test",
			ts: new Date().toISOString(),
			todoPath,
			workers: [
				{
					id: "rif00001",
					contractId: "manual-exit-code-state",
					contractTitle: "Manual exit code state",
					worktreePath: join(dir, ".evalgate-worktrees", "rif00001"),
					branch: "evalgate/manual-exit-code-state-rif00001",
					status: "failed",
					startedAt: new Date(Date.now() - 5000).toISOString(),
					finishedAt: new Date().toISOString(),
					agentExitCode: 2, // does NOT satisfy >= 5
					verifierPassed: false,
					failureKind: "verifier-fail",
					logPath: join(dir, ".evalgate", "sessions", "rif00001.log"),
				},
			],
		};
		saveState(todoPath, preState);

		const finalWorker = await retryWorker("rif00001", todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(
			finalWorker.status,
			"failed",
			"worker should remain failed when retryIf condition is not met",
		);
		assert.equal(
			finalWorker.failureKind,
			"verifier-fail",
			"failureKind should be verifier-fail when retry is skipped",
		);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker retryIf condition met on manually set agentExitCode — proceeds to retry", async () => {
	const dir = makeTmpRepo();
	try {
		// agentExitCode: 7 — condition (>= 5) IS met → retry proceeds and verifier passes.
		const todoPath = writeTodo(
			dir,
			`${[
				"- [ ] Manual exit code state pass",
				"  - eval: `true`",
				"  - retry-if: exit-code >= 5",
			].join("\n")}\n`,
		);

		mkdirSync(join(dir, ".evalgate", "sessions"), { recursive: true });

		const preState: SwarmState = {
			id: "retry-if-manual-pass-test",
			ts: new Date().toISOString(),
			todoPath,
			workers: [
				{
					id: "rif00002",
					contractId: "manual-exit-code-state-pass",
					contractTitle: "Manual exit code state pass",
					worktreePath: join(dir, ".evalgate-worktrees", "rif00002"),
					branch: "evalgate/manual-exit-code-state-pass-rif00002",
					status: "failed",
					startedAt: new Date(Date.now() - 5000).toISOString(),
					finishedAt: new Date().toISOString(),
					agentExitCode: 7, // satisfies >= 5
					verifierPassed: false,
					failureKind: "verifier-fail",
					logPath: join(dir, ".evalgate", "sessions", "rif00002.log"),
				},
			],
		};
		saveState(todoPath, preState);

		const finalWorker = await retryWorker("rif00002", todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(
			finalWorker.status,
			"done",
			"worker should be done when retryIf condition is met and verifier passes",
		);
		assert.equal(finalWorker.verifierPassed, true);
	} finally {
		cleanup(dir);
	}
});
