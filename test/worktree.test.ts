/**
 * Tests for src/worktree.ts
 *
 * We spin up a real temporary git repo so these tests exercise the actual
 * git commands. No mocking — git worktree requires a real repo.
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createWorktree,
	deleteBranch,
	getRepoRoot,
	mergeWorktree,
	removeWorktree,
} from "../src/worktree.js";

function makeTmpRepo(): string {
	const dir = join(
		tmpdir(),
		`evalgate-wt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	execSync("git init -b main", { cwd: dir, stdio: "pipe" });
	execSync('git config user.email "test@evalgate.test"', { cwd: dir, stdio: "pipe" });
	execSync('git config user.name "evalgate test"', { cwd: dir, stdio: "pipe" });
	// Initial commit — required before worktrees can be added
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

test("getRepoRoot returns the repo root", () => {
	const repo = makeTmpRepo();
	try {
		const root = getRepoRoot(repo);
		// Resolve symlinks on both sides — on macOS /tmp is a symlink to /private/tmp
		assert.equal(realpathSync(root), realpathSync(repo));
	} finally {
		cleanup(repo);
	}
});

test("getRepoRoot throws when not in a git repo", () => {
	const dir = join(tmpdir(), `not-a-repo-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	try {
		assert.throws(() => getRepoRoot(dir), /failed/i);
	} finally {
		cleanup(dir);
	}
});

test("createWorktree creates a new branch and directory", () => {
	const repo = makeTmpRepo();
	const wtPath = join(tmpdir(), `evalgate-wt-${Date.now()}`);
	try {
		createWorktree(repo, "test-branch", wtPath);
		// Verify the worktree directory was created
		const dirs = execSync("git worktree list --porcelain", { cwd: repo, encoding: "utf8" });
		assert.ok(dirs.includes(wtPath), "worktree path should appear in git worktree list");
	} finally {
		// Try removing even if test failed mid-way
		try {
			removeWorktree(repo, wtPath);
		} catch {
			/* ignore */
		}
		cleanup(repo);
		cleanup(wtPath);
	}
});

test("removeWorktree removes the worktree", () => {
	const repo = makeTmpRepo();
	const wtPath = join(tmpdir(), `evalgate-wt-${Date.now()}`);
	try {
		createWorktree(repo, "rm-branch", wtPath);
		removeWorktree(repo, wtPath);
		const list = execSync("git worktree list --porcelain", { cwd: repo, encoding: "utf8" });
		assert.ok(!list.includes(wtPath), "worktree should be removed from list");
	} finally {
		cleanup(repo);
		cleanup(wtPath);
	}
});

test("mergeWorktree merges a branch back", () => {
	const repo = makeTmpRepo();
	const wtPath = join(tmpdir(), `evalgate-wt-${Date.now()}`);
	try {
		createWorktree(repo, "merge-branch", wtPath);
		// Make a commit in the worktree
		writeFileSync(join(wtPath, "feature.txt"), "hello\n");
		execSync("git add -A && git commit --no-gpg-sign -m 'feature'", {
			cwd: wtPath,
			stdio: "pipe",
			shell: true,
		});
		removeWorktree(repo, wtPath);
		// Merge back
		mergeWorktree(repo, "merge-branch");
		// Verify the file landed in the main repo
		const log = execSync("git log --oneline", { cwd: repo, encoding: "utf8" });
		assert.ok(log.includes("feature"), "merge commit should be in log");
	} finally {
		cleanup(repo);
		cleanup(wtPath);
	}
});

test("deleteBranch is best-effort and does not throw on missing branch", () => {
	const repo = makeTmpRepo();
	try {
		// Should not throw even if branch doesn't exist
		assert.doesNotThrow(() => deleteBranch(repo, "nonexistent-branch-xyz"));
	} finally {
		cleanup(repo);
	}
});
