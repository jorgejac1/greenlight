/**
 * Tests for src/spawn.ts
 *
 * We spawn real processes (echo, node, false) instead of mocking child_process
 * so these tests verify actual I/O streaming and exit-code propagation.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnAgent } from "../src/spawn.js";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`evalgate-spawn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

test("spawnAgent resolves with exit code 0 for a passing command", async () => {
	const dir = makeTmpDir();
	try {
		const logPath = join(dir, "sessions", "w1.log");
		const exitCode = await spawnAgent({
			cwd: dir,
			task: "echo test",
			logPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.equal(exitCode, 0);
	} finally {
		cleanup(dir);
	}
});

test("spawnAgent resolves with non-zero exit code for a failing command", async () => {
	const dir = makeTmpDir();
	try {
		const logPath = join(dir, "sessions", "w2.log");
		const exitCode = await spawnAgent({
			cwd: dir,
			task: "fail task",
			logPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(1)"],
		});
		assert.equal(exitCode, 1);
	} finally {
		cleanup(dir);
	}
});

test("spawnAgent streams stdout to log file", async () => {
	const dir = makeTmpDir();
	try {
		const logPath = join(dir, "sessions", "w3.log");
		await spawnAgent({
			cwd: dir,
			task: "print hello",
			logPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.stdout.write('hello from agent\\n')"],
		});
		assert.ok(existsSync(logPath), "log file should be created");
		const contents = readFileSync(logPath, "utf8");
		assert.ok(contents.includes("hello from agent"), "stdout should be in log");
	} finally {
		cleanup(dir);
	}
});

test("spawnAgent streams stderr to log file", async () => {
	const dir = makeTmpDir();
	try {
		const logPath = join(dir, "sessions", "w4.log");
		await spawnAgent({
			cwd: dir,
			task: "print error",
			logPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.stderr.write('error from agent\\n')"],
		});
		const contents = readFileSync(logPath, "utf8");
		assert.ok(contents.includes("error from agent"), "stderr should be in log");
	} finally {
		cleanup(dir);
	}
});

test("spawnAgent creates parent directories for logPath", async () => {
	const dir = makeTmpDir();
	try {
		const logPath = join(dir, "deeply", "nested", "sessions", "w5.log");
		await spawnAgent({
			cwd: dir,
			task: "nested log",
			logPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		assert.ok(existsSync(logPath), "log file should be created in nested dir");
	} finally {
		cleanup(dir);
	}
});

test("spawnAgent returns -1 when command is not found", async () => {
	const dir = makeTmpDir();
	try {
		const logPath = join(dir, "sessions", "w6.log");
		const exitCode = await spawnAgent({
			cwd: dir,
			task: "bad cmd",
			logPath,
			agentCmd: "this-command-does-not-exist-evalgate-test",
			agentArgs: [],
		});
		// On ENOENT, Node fires both 'error' and 'close'; we settle with the
		// first one. Exact code is platform-dependent (-1, -2, etc.).
		assert.ok(exitCode < 0, `exit code should be negative, got ${exitCode}`);
		// Log should contain the spawn error message
		const contents = readFileSync(logPath, "utf8");
		assert.ok(contents.includes("spawn error"), "log should contain spawn error");
	} finally {
		cleanup(dir);
	}
});

test("spawnAgent writes header lines to the log", async () => {
	const dir = makeTmpDir();
	try {
		const logPath = join(dir, "sessions", "w7.log");
		await spawnAgent({
			cwd: dir,
			task: "header test",
			logPath,
			agentCmd: "node",
			agentArgs: ["-e", "process.exit(0)"],
		});
		const contents = readFileSync(logPath, "utf8");
		assert.ok(contents.includes("[evalgate swarm] starting agent"), "should have header");
		assert.ok(contents.includes("[evalgate swarm] cwd:"), "should have cwd");
	} finally {
		cleanup(dir);
	}
});
