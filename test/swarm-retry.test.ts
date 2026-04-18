/**
 * Tests for retryWorker — the swarm retry primitive.
 *
 * Each test sets up a real git repo and exercises the retryWorker function
 * using trivially fast agent commands (node -e '...') so the suite runs
 * quickly without spawning real AI agents.
 *
 * Helpers are intentionally copied from swarm.test.ts to keep these tests
 * self-contained (no cross-test imports).
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { retryWorker, runSwarm } from "../src/swarm.js";
import { loadState, saveState } from "../src/swarm-state.js";
import type { SwarmState } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test helpers (self-contained copies — not imported from swarm.test.ts)
// ---------------------------------------------------------------------------

function makeTmpRepo(): string {
	const dir = join(
		tmpdir(),
		`evalgate-retry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

test("retryWorker rejects when no swarm state exists", async () => {
	const dir = makeTmpRepo();
	try {
		const todoPath = writeTodo(dir, "- [ ] Some task\n  - eval: `true`\n");
		// No runSwarm call — no state file.
		await assert.rejects(
			() => retryWorker("nonexistent", todoPath, { todoPath }),
			/no swarm state found/i,
		);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker rejects when worker id is not found in state", async () => {
	const dir = makeTmpRepo();
	try {
		const todoPath = writeTodo(dir, "- [ ] Task\n  - eval: `false`\n");
		await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		// Use a worker id that doesn't exist.
		await assert.rejects(
			() => retryWorker("notaworker", todoPath, { todoPath }),
			/worker not found/i,
		);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker rejects when worker status is done (not retryable)", async () => {
	const dir = makeTmpRepo();
	try {
		const todoPath = writeTodo(dir, "- [ ] Passing task\n  - eval: `true`\n");
		const result = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		const doneWorker = result.state.workers.find((w) => w.status === "done");
		assert.ok(doneWorker, "should have a done worker to test against");
		await assert.rejects(
			() => retryWorker(doneWorker.id, todoPath, { todoPath }),
			/not retryable.*done/i,
		);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker on a failed worker with passing verifier → status done", async () => {
	const dir = makeTmpRepo();
	try {
		// First run: agent exits 0 but verifier is `false` → worker fails.
		const todoPath = writeTodo(dir, "- [ ] Retry me\n  - eval: `false`\n");
		const firstRun = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.equal(firstRun.failed, 1, "initial run should produce one failed worker");

		const failedWorker = firstRun.state.workers.find((w) => w.status === "failed");
		assert.ok(failedWorker, "should have a failed worker to retry");

		// Update the todo.md so the verifier now passes (`true`).
		writeFileSync(todoPath, "- [ ] Retry me\n  - eval: `true`\n");
		execSync("git add todo.md && git commit --no-gpg-sign -m 'fix verifier'", {
			cwd: dir,
			stdio: "pipe",
			shell: true,
		});

		// Retry: agent exits 0 and verifier now passes → worker should be done.
		const finalWorker = await retryWorker(failedWorker.id, todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(finalWorker.status, "done", "retried worker should end up done");
		assert.equal(finalWorker.verifierPassed, true);
		assert.ok(finalWorker.finishedAt, "should have a finishedAt timestamp");
	} finally {
		cleanup(dir);
	}
});

test("retryWorker on a failed worker with still-failing verifier → stays failed", async () => {
	const dir = makeTmpRepo();
	try {
		const todoPath = writeTodo(dir, "- [ ] Always failing\n  - eval: `false`\n");
		const firstRun = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.equal(firstRun.failed, 1);

		const failedWorker = firstRun.state.workers.find((w) => w.status === "failed");
		assert.ok(failedWorker, "need a failed worker for retry");

		// Retry with verifier still failing.
		const finalWorker = await retryWorker(failedWorker.id, todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(finalWorker.status, "failed", "should remain failed when verifier still fails");
		assert.equal(finalWorker.verifierPassed, false);
	} finally {
		cleanup(dir);
	}
});

test("retryWorker writes a context file and sets EVALGATE_RETRY_CONTEXT_FILE in env", async () => {
	const dir = makeTmpRepo();
	try {
		// First run: fail so we have a worker to retry.
		const todoPath = writeTodo(dir, "- [ ] Context check\n  - eval: `false`\n");
		const firstRun = await runSwarm({
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		const failedWorker = firstRun.state.workers.find((w) => w.status === "failed");
		assert.ok(failedWorker);

		// Write something to the log so there's content to capture.
		writeFileSync(failedWorker.logPath, "previous failure output\n", { flag: "a" });

		// Use an agent that writes the context file path to a sentinel file,
		// so we can verify the env var was actually set.
		const sentinelPath = join(dir, "context-file-path.txt");
		const agentScript = `
      var fs = require('fs');
      var ctx = process.env.EVALGATE_RETRY_CONTEXT_FILE;
      if (ctx) { fs.writeFileSync(${JSON.stringify(sentinelPath)}, ctx, 'utf8'); }
      process.exit(0);
    `;

		// Update todo.md with a passing verifier for the retry.
		writeFileSync(todoPath, "- [ ] Context check\n  - eval: `true`\n");
		execSync("git add todo.md && git commit --no-gpg-sign -m 'fix verifier'", {
			cwd: dir,
			stdio: "pipe",
			shell: true,
		});

		await retryWorker(failedWorker.id, todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", agentScript],
		});

		// The sentinel file should contain the path to the context file.
		assert.ok(existsSync(sentinelPath), "agent should have received EVALGATE_RETRY_CONTEXT_FILE");
		const contextFilePath = readFileSync(sentinelPath, "utf8").trim();
		assert.ok(existsSync(contextFilePath), "context file should exist at the path given to agent");
		const contextContent = readFileSync(contextFilePath, "utf8");
		assert.match(contextContent, /retry context/i, "context file should contain header text");
	} finally {
		cleanup(dir);
	}
});

test("retryWorker updates state correctly — pending→ done/failed round-trip", async () => {
	const dir = makeTmpRepo();
	try {
		// Set up a manually crafted failed state (avoids running a full swarm).
		const todoPath = writeTodo(dir, "- [ ] Manual state task\n  - eval: `true`\n");
		mkdirSync(join(dir, ".evalgate", "sessions"), { recursive: true });

		const preState: SwarmState = {
			id: "manual-test",
			ts: new Date().toISOString(),
			todoPath,
			workers: [
				{
					id: "man00001",
					contractId: "manual-state-task",
					contractTitle: "Manual state task",
					worktreePath: join(dir, ".evalgate-worktrees", "man00001"),
					branch: "evalgate/manual-state-task-man00001",
					status: "failed",
					startedAt: new Date(Date.now() - 10000).toISOString(),
					finishedAt: new Date().toISOString(),
					verifierPassed: false,
					logPath: join(dir, ".evalgate", "sessions", "man00001.log"),
				},
			],
		};
		saveState(todoPath, preState);

		// Verify the pre-state is failed.
		const stateBeforeRetry = loadState(todoPath);
		assert.equal(stateBeforeRetry?.workers[0]?.status, "failed");

		// Retry — verifier is `true` so it should pass.
		const finalWorker = await retryWorker("man00001", todoPath, {
			todoPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});

		assert.equal(finalWorker.id, "man00001");
		assert.equal(finalWorker.status, "done");
		assert.equal(finalWorker.verifierPassed, true);
		assert.ok(finalWorker.finishedAt, "should have a finishedAt after retry");
	} finally {
		cleanup(dir);
	}
});
