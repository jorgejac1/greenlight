/**
 * Parser-level tests for eval.http and eval.schema verifier fields added in v2.2.
 *
 * Covers: correct field mapping to HttpVerifier / SchemaVerifier, all optional
 * sub-fields, and graceful handling of malformed input.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTodo } from "../src/parser.js";

// ---------------------------------------------------------------------------
// eval.http verifier
// ---------------------------------------------------------------------------

test("eval.http: parses to HttpVerifier with correct url", () => {
	const src = ["- [ ] Health check", "  - eval.http: http://localhost:3000/health"].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "http",
		url: "http://localhost:3000/health",
	});
});

test("eval.http.status: sets the status field", () => {
	const src = [
		"- [ ] Created endpoint check",
		"  - eval.http: http://localhost:3000/api/resource",
		"  - eval.http.status: 201",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "http",
		url: "http://localhost:3000/api/resource",
		status: 201,
	});
});

test("eval.http.contains: sets the contains field", () => {
	const src = [
		"- [ ] API returns healthy",
		"  - eval.http: http://localhost:4000/status",
		'  - eval.http.contains: "status":"ok"',
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "http",
		url: "http://localhost:4000/status",
		contains: '"status":"ok"',
	});
});

test("eval.http.timeout: sets the timeoutMs field", () => {
	const src = [
		"- [ ] Fast health check",
		"  - eval.http: http://localhost:8080/ping",
		"  - eval.http.timeout: 5000",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "http",
		url: "http://localhost:8080/ping",
		timeoutMs: 5000,
	});
});

test("eval.http: all optional sub-fields together", () => {
	const src = [
		"- [ ] Full HTTP verifier",
		"  - eval.http: https://api.example.com/ready",
		"  - eval.http.status: 200",
		"  - eval.http.contains: ready",
		"  - eval.http.timeout: 3000",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "http",
		url: "https://api.example.com/ready",
		status: 200,
		contains: "ready",
		timeoutMs: 3000,
	});
});

// ---------------------------------------------------------------------------
// eval.schema verifier
// ---------------------------------------------------------------------------

test("eval.schema: parses file path and inline schema correctly", () => {
	const src = [
		"- [ ] Output has required fields",
		'  - eval.schema: output.json {"type":"object","required":["id","score"]}',
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "schema",
		file: "output.json",
		schema: '{"type":"object","required":["id","score"]}',
	});
});

test("eval.schema: parses file path with nested path segments", () => {
	const src = [
		"- [ ] Nested file schema check",
		'  - eval.schema: dist/output/result.json {"type":"array"}',
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "schema",
		file: "dist/output/result.json",
		schema: '{"type":"array"}',
	});
});

test("eval.schema: parses schema with properties", () => {
	const src = [
		"- [ ] API response shape",
		'  - eval.schema: response.json {"type":"object","properties":{"id":{"type":"string"},"score":{"type":"number"}}}',
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.verifier, {
		kind: "schema",
		file: "response.json",
		schema: '{"type":"object","properties":{"id":{"type":"string"},"score":{"type":"number"}}}',
	});
});

test("eval.schema: missing schema JSON (only file path) returns undefined verifier gracefully", () => {
	// No space after the file name — no schema JSON provided.
	const src = ["- [ ] Malformed schema", "  - eval.schema: output.json"].join("\n");

	const [c] = parseTodo(src);
	// The parser requires a space + schema after the file path; without it, no
	// SchemaVerifier is produced and the contract falls back to undefined.
	assert.strictEqual(c.verifier, undefined);
});

test("eval.schema: empty value returns undefined verifier gracefully", () => {
	const src = ["- [ ] Empty schema", "  - eval.schema: "].join("\n");

	const [c] = parseTodo(src);
	assert.strictEqual(c.verifier, undefined);
});
