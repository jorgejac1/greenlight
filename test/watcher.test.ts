import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTodo } from "../src/parser.js";
import { matchesGlob } from "../src/watcher.js";

// ---------------------------------------------------------------------------
// Parser — trigger field parsing
// ---------------------------------------------------------------------------

describe("parser — trigger fields", () => {
	it("parses schedule trigger", () => {
		const contracts = parseTodo(
			`- [ ] Nightly tests\n  - eval: \`pnpm test\`\n  - on: schedule: "0 2 * * *"\n`,
		);
		assert.equal(contracts.length, 1);
		const trigger = contracts[0].trigger;
		assert.ok(trigger, "trigger should be defined");
		assert.equal(trigger.kind, "schedule");
		if (trigger.kind === "schedule") {
			assert.equal(trigger.cron, "0 2 * * *");
		}
	});

	it("parses watch trigger", () => {
		const contracts = parseTodo(
			`- [ ] Auth tests\n  - eval: \`pnpm test src/auth\`\n  - on: watch: "src/auth/**"\n`,
		);
		const trigger = contracts[0].trigger;
		assert.ok(trigger);
		assert.equal(trigger.kind, "watch");
		if (trigger.kind === "watch") {
			assert.equal(trigger.glob, "src/auth/**");
		}
	});

	it("parses webhook trigger", () => {
		const contracts = parseTodo(
			`- [ ] CI gate\n  - eval: \`pnpm test\`\n  - on: webhook: "/ci-passed"\n`,
		);
		const trigger = contracts[0].trigger;
		assert.ok(trigger);
		assert.equal(trigger.kind, "webhook");
		if (trigger.kind === "webhook") {
			assert.equal(trigger.path, "/ci-passed");
		}
	});

	it("prefixes webhook path with / if missing", () => {
		const contracts = parseTodo(
			`- [ ] CI gate\n  - eval: \`pnpm test\`\n  - on: webhook: ci-passed\n`,
		);
		const trigger = contracts[0].trigger;
		assert.ok(trigger);
		if (trigger.kind === "webhook") {
			assert.equal(trigger.path, "/ci-passed");
		}
	});

	it("returns undefined trigger for contracts without on: field", () => {
		const contracts = parseTodo(`- [ ] Manual task\n  - eval: \`pnpm test\`\n`);
		assert.equal(contracts[0].trigger, undefined);
	});

	it("returns undefined trigger for unrecognized on: value", () => {
		const contracts = parseTodo(
			`- [ ] Bad trigger\n  - eval: \`pnpm test\`\n  - on: unknown: something\n`,
		);
		assert.equal(contracts[0].trigger, undefined);
	});

	it("parses trigger alongside other fields", () => {
		const contracts = parseTodo(
			`- [ ] Full contract\n  - eval: \`pnpm test\`\n  - retries: 2\n  - budget: 30k\n  - on: schedule: "*/5 * * * *"\n`,
		);
		const c = contracts[0];
		assert.ok(c.trigger);
		assert.equal(c.retries, 2);
		assert.equal(c.budget, 30_000);
		assert.equal(c.trigger?.kind, "schedule");
	});
});

// ---------------------------------------------------------------------------
// matchesGlob
// ---------------------------------------------------------------------------

describe("matchesGlob", () => {
	it("matches exact filename", () => {
		assert.equal(matchesGlob("src/auth.ts", "src/auth.ts"), true);
	});

	it("matches single-segment wildcard", () => {
		assert.equal(matchesGlob("src/auth.ts", "src/*.ts"), true);
		assert.equal(matchesGlob("src/nested/auth.ts", "src/*.ts"), false);
	});

	it("matches globstar across segments", () => {
		assert.equal(matchesGlob("src/auth/index.ts", "src/**"), true);
		assert.equal(matchesGlob("src/auth/nested/deep.ts", "src/**"), true);
	});

	it("matches globstar with extension", () => {
		assert.equal(matchesGlob("src/auth/index.ts", "src/**/*.ts"), true);
		assert.equal(matchesGlob("src/auth/index.js", "src/**/*.ts"), false);
	});

	it("matches question mark wildcard", () => {
		assert.equal(matchesGlob("src/a.ts", "src/?.ts"), true);
		assert.equal(matchesGlob("src/ab.ts", "src/?.ts"), false);
	});

	it("does not match path separator with single star", () => {
		assert.equal(matchesGlob("a/b/c.ts", "a/*.ts"), false);
	});

	it("handles Windows-style backslash separators", () => {
		assert.equal(matchesGlob("src\\auth\\index.ts", "src/**/*.ts"), true);
	});
});
