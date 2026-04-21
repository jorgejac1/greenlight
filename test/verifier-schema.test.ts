/**
 * Tests for the eval.schema verifier added in v2.2.
 *
 * Uses a temp directory with real JSON files — zero external dependencies.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Contract, SchemaVerifier } from "../src/types.js";
import { runContract } from "../src/verifier.js";

function makeContract(verifier: SchemaVerifier): Contract {
	return {
		id: "test-schema",
		title: "Test schema verifier",
		checked: false,
		status: "pending",
		verifier,
		line: 0,
		rawLines: [0],
	};
}

function tmpDir(): { dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "evalgate-schema-test-"));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("schema verifier", () => {
	it("passes for valid JSON matching schema", async () => {
		const { dir, cleanup } = tmpDir();
		try {
			writeFileSync(join(dir, "output.json"), JSON.stringify({ id: "abc", score: 42 }));
			const result = await runContract(
				makeContract({
					kind: "schema",
					file: "output.json",
					schema: '{"type":"object","required":["id","score"]}',
				}),
				dir,
			);
			assert.strictEqual(result.passed, true);
		} finally {
			cleanup();
		}
	});

	it("fails when a required field is missing", async () => {
		const { dir, cleanup } = tmpDir();
		try {
			writeFileSync(join(dir, "output.json"), JSON.stringify({ id: "abc" }));
			const result = await runContract(
				makeContract({
					kind: "schema",
					file: "output.json",
					schema: '{"type":"object","required":["id","score"]}',
				}),
				dir,
			);
			assert.strictEqual(result.passed, false);
			assert.ok(result.stderr.includes('"score"'));
		} finally {
			cleanup();
		}
	});

	it("fails when a property type does not match", async () => {
		const { dir, cleanup } = tmpDir();
		try {
			writeFileSync(join(dir, "output.json"), JSON.stringify({ id: 123, score: 42 }));
			const result = await runContract(
				makeContract({
					kind: "schema",
					file: "output.json",
					schema: '{"type":"object","properties":{"id":{"type":"string"}}}',
				}),
				dir,
			);
			assert.strictEqual(result.passed, false);
			assert.ok(result.stderr.includes('"id"'));
			assert.ok(result.stderr.includes('"string"'));
		} finally {
			cleanup();
		}
	});

	it("fails when file does not exist", async () => {
		const { dir, cleanup } = tmpDir();
		try {
			const result = await runContract(
				makeContract({
					kind: "schema",
					file: "nonexistent.json",
					schema: '{"type":"object"}',
				}),
				dir,
			);
			assert.strictEqual(result.passed, false);
			assert.ok(result.stderr.includes("not found"));
		} finally {
			cleanup();
		}
	});

	it("fails when top-level type does not match", async () => {
		const { dir, cleanup } = tmpDir();
		try {
			writeFileSync(join(dir, "output.json"), JSON.stringify([1, 2, 3]));
			const result = await runContract(
				makeContract({
					kind: "schema",
					file: "output.json",
					schema: '{"type":"object"}',
				}),
				dir,
			);
			assert.strictEqual(result.passed, false);
			assert.ok(result.stderr.includes('"object"'));
		} finally {
			cleanup();
		}
	});

	it("passes for array type when value is an array", async () => {
		const { dir, cleanup } = tmpDir();
		try {
			writeFileSync(join(dir, "items.json"), JSON.stringify([{ id: 1 }, { id: 2 }]));
			const result = await runContract(
				makeContract({
					kind: "schema",
					file: "items.json",
					schema: '{"type":"array"}',
				}),
				dir,
			);
			assert.strictEqual(result.passed, true);
		} finally {
			cleanup();
		}
	});
});
