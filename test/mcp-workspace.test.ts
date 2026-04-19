/**
 * MCP workspace support tests — verifies named workspace resolution,
 * list_workspaces tool, and backward-compat path param behavior.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RpcResult {
	result?: unknown;
	error?: { code: number; message: string };
}

/**
 * Spawn the evalgate MCP server with optional workspace flags, send requests,
 * and collect responses.
 */
function rpcWithWorkspaces(
	cwd: string,
	workspaces: Record<string, string>,
	requests: object[],
): Promise<RpcResult[]> {
	const expectedCount = requests.filter((r) => (r as Record<string, unknown>).id != null).length;
	const wsFlags = Object.entries(workspaces).map(([name, path]) => `--workspace=${name}:${path}`);

	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["--import", "tsx", join(process.cwd(), "src/cli.ts"), "serve", cwd, ...wsFlags],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);

		const results: RpcResult[] = [];
		let buffer = "";

		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error(`MCP server timeout — got ${results.length}/${expectedCount} responses`));
		}, 15_000);

		child.stdout.on("data", (d: Buffer) => {
			buffer += d.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					results.push(JSON.parse(trimmed) as RpcResult);
				} catch {
					results.push({ error: { code: -1, message: `bad json: ${trimmed}` } });
				}
				if (results.length >= expectedCount) {
					clearTimeout(timeout);
					child.stdin.end();
				}
			}
		});

		for (const req of requests) {
			child.stdin.write(`${JSON.stringify(req)}\n`);
		}

		child.on("close", () => {
			clearTimeout(timeout);
			resolve(results);
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});
	});
}

function makeTmpProject(todoContent: string): string {
	const dir = join(tmpdir(), `gl-ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "todo.md"), todoContent);
	return dir;
}

function cleanup(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
}

let _id = 1;
function req(method: string, params: object = {}): object {
	return { jsonrpc: "2.0", id: _id++, method, params };
}

function getToolData(resp: RpcResult): Record<string, unknown> {
	const content = (resp.result as Record<string, unknown>).content as Array<
		Record<string, unknown>
	>;
	return JSON.parse(content[0].text as string) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP workspace — list_workspaces tool", () => {
	it("returns empty list when no workspaces configured", async () => {
		const dir = makeTmpProject("- [ ] nothing\n");
		try {
			const [, resp] = await rpcWithWorkspaces(dir, {}, [
				req("initialize"),
				req("tools/call", { name: "list_workspaces", arguments: {} }),
			]);
			const data = getToolData(resp);
			assert.equal(data.count, 0);
			assert.deepEqual(data.workspaces, []);
		} finally {
			cleanup(dir);
		}
	});

	it("returns configured workspaces with names and paths", async () => {
		const dir1 = makeTmpProject("- [ ] Task A\n  - eval: `echo a`\n");
		const dir2 = makeTmpProject("- [ ] Task B\n  - eval: `echo b`\n");
		try {
			const ws = {
				alpha: join(dir1, "todo.md"),
				beta: join(dir2, "todo.md"),
			};
			const [, resp] = await rpcWithWorkspaces(dir1, ws, [
				req("initialize"),
				req("tools/call", { name: "list_workspaces", arguments: {} }),
			]);
			const data = getToolData(resp);
			assert.equal(data.count, 2);
			const entries = data.workspaces as Array<{ name: string; path: string }>;
			const names = entries.map((e) => e.name).sort();
			assert.deepEqual(names, ["alpha", "beta"]);
		} finally {
			cleanup(dir1);
			cleanup(dir2);
		}
	});

	it("list_workspaces is included in tools/list", async () => {
		const dir = makeTmpProject("- [ ] nothing\n");
		try {
			const [, resp] = await rpcWithWorkspaces(dir, {}, [req("initialize"), req("tools/list")]);
			const result = resp.result as Record<string, unknown>;
			const tools = result.tools as Array<Record<string, unknown>>;
			const names = tools.map((t) => t.name as string);
			assert.ok(names.includes("list_workspaces"), "list_workspaces must be in tools/list");
		} finally {
			cleanup(dir);
		}
	});
});

describe("MCP workspace — workspace param routing", () => {
	it("routes list_pending to the correct workspace by name", async () => {
		const dirA = makeTmpProject(
			"- [ ] Alpha task\n  - eval: `echo alpha`\n- [ ] Alpha task two\n  - eval: `echo alpha2`\n",
		);
		const dirB = makeTmpProject("- [ ] Beta task\n  - eval: `echo beta`\n");
		try {
			const ws = {
				track_a: join(dirA, "todo.md"),
				track_b: join(dirB, "todo.md"),
			};
			const [, respA, respB] = await rpcWithWorkspaces(dirA, ws, [
				req("initialize"),
				req("tools/call", { name: "list_pending", arguments: { workspace: "track_a" } }),
				req("tools/call", { name: "list_pending", arguments: { workspace: "track_b" } }),
			]);
			const dataA = getToolData(respA);
			const dataB = getToolData(respB);
			assert.equal(dataA.count, 2, "track_a should have 2 pending");
			assert.equal(dataB.count, 1, "track_b should have 1 pending");
		} finally {
			cleanup(dirA);
			cleanup(dirB);
		}
	});

	it("returns an error for an unknown workspace name", async () => {
		const dir = makeTmpProject("- [ ] task\n  - eval: `echo ok`\n");
		try {
			const [, resp] = await rpcWithWorkspaces(dir, {}, [
				req("initialize"),
				req("tools/call", {
					name: "list_pending",
					arguments: { workspace: "does_not_exist" },
				}),
			]);
			// The dispatch catches the thrown error and returns it as an RPC error
			assert.ok(
				resp.error ?? (getToolData(resp).error as string | undefined),
				"should return an error for unknown workspace",
			);
		} finally {
			cleanup(dir);
		}
	});

	it("falls back to path param when no workspace given", async () => {
		const dir = makeTmpProject("- [ ] Fallback task\n  - eval: `echo ok`\n");
		try {
			const [, resp] = await rpcWithWorkspaces(dir, {}, [
				req("initialize"),
				req("tools/call", {
					name: "list_pending",
					arguments: { path: join(dir, "todo.md") },
				}),
			]);
			const data = getToolData(resp);
			assert.equal(data.count, 1);
			const contracts = data.contracts as Array<Record<string, unknown>>;
			assert.equal(contracts[0].id, "fallback-task");
		} finally {
			cleanup(dir);
		}
	});

	it("workspace param takes precedence over path param", async () => {
		const dirA = makeTmpProject("- [ ] Workspace task\n  - eval: `echo ws`\n");
		const dirB = makeTmpProject("- [ ] Path task\n  - eval: `echo path`\n");
		try {
			const ws = { ws_a: join(dirA, "todo.md") };
			const [, resp] = await rpcWithWorkspaces(dirA, ws, [
				req("initialize"),
				req("tools/call", {
					name: "list_pending",
					// Both workspace and path given — workspace wins
					arguments: { workspace: "ws_a", path: join(dirB, "todo.md") },
				}),
			]);
			const data = getToolData(resp);
			const contracts = data.contracts as Array<Record<string, unknown>>;
			assert.equal(contracts[0].id, "workspace-task", "workspace param should win over path");
		} finally {
			cleanup(dirA);
			cleanup(dirB);
		}
	});
});

describe("MCP workspace — server version", () => {
	it("reports current package version in initialize response", async () => {
		const dir = makeTmpProject("- [ ] nothing\n");
		try {
			const [resp] = await rpcWithWorkspaces(dir, {}, [
				req("initialize", {
					protocolVersion: "2024-11-05",
					clientInfo: { name: "test", version: "1" },
					capabilities: {},
				}),
			]);
			assert.ok(resp.result, "expected result");
			const result = resp.result as Record<string, unknown>;
			const serverInfo = result.serverInfo as Record<string, unknown>;
			// Version is now read dynamically from package.json
			assert.equal(typeof serverInfo.version, "string");
			assert.ok((serverInfo.version as string).length > 0);
		} finally {
			cleanup(dir);
		}
	});
});
