/**
 * Tests for retry-if parser added in v2.2.
 *
 * Covers: valid exit-code expressions, all operators, silent ignore of bad values.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTodo } from "../src/parser.js";

test("parses retry-if: exit-code > 1", () => {
	const src = [
		"- [ ] Build with retry condition",
		"  - eval: `npm run build`",
		"  - retry-if: exit-code > 1",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.retryIf, { exitCode: { op: ">", value: 1 } });
});

test("parses retry-if: exit-code != 0", () => {
	const src = [
		"- [ ] Task with != condition",
		"  - eval: `npm test`",
		"  - retry-if: exit-code != 0",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.retryIf, { exitCode: { op: "!=", value: 0 } });
});

test("parses retry-if: exit-code == 2", () => {
	const src = [
		"- [ ] Task with == condition",
		"  - eval: `true`",
		"  - retry-if: exit-code == 2",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.retryIf, { exitCode: { op: "==", value: 2 } });
});

test("parses retry-if: exit-code >= 1", () => {
	const src = [
		"- [ ] Task with >= condition",
		"  - eval: `true`",
		"  - retry-if: exit-code >= 1",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.retryIf, { exitCode: { op: ">=", value: 1 } });
});

test("parses retry-if: exit-code <= 5", () => {
	const src = [
		"- [ ] Task with <= condition",
		"  - eval: `true`",
		"  - retry-if: exit-code <= 5",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.retryIf, { exitCode: { op: "<=", value: 5 } });
});

test("parses retry-if: exit-code < 3", () => {
	const src = [
		"- [ ] Task with < condition",
		"  - eval: `true`",
		"  - retry-if: exit-code < 3",
	].join("\n");

	const [c] = parseTodo(src);
	assert.deepEqual(c.retryIf, { exitCode: { op: "<", value: 3 } });
});

test("silently ignores unparseable retry-if value", () => {
	const src = [
		"- [ ] Task with bad retry-if",
		"  - eval: `true`",
		"  - retry-if: some-invalid-value",
	].join("\n");

	const [c] = parseTodo(src);
	assert.strictEqual(c.retryIf, undefined);
});

test("silently ignores retry-if with unknown keyword", () => {
	const src = [
		"- [ ] Task with unknown condition",
		"  - eval: `true`",
		"  - retry-if: memory > 500",
	].join("\n");

	const [c] = parseTodo(src);
	assert.strictEqual(c.retryIf, undefined);
});

test("contract without retry-if has retryIf undefined", () => {
	const src = ["- [ ] Normal task", "  - eval: `true`"].join("\n");

	const [c] = parseTodo(src);
	assert.strictEqual(c.retryIf, undefined);
});
