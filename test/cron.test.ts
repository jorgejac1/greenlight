import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesCron, nextFireMs, parseCron } from "../src/cron.js";

describe("parseCron", () => {
	it("parses a simple daily cron", () => {
		const expr = parseCron("0 2 * * *");
		assert.deepEqual(expr.minutes, [0]);
		assert.deepEqual(expr.hours, [2]);
		assert.equal(expr.days.length, 31);
		assert.equal(expr.months.length, 12);
		assert.equal(expr.weekdays.length, 7);
	});

	it("parses a step expression", () => {
		const expr = parseCron("*/15 * * * *");
		assert.deepEqual(expr.minutes, [0, 15, 30, 45]);
	});

	it("parses a range", () => {
		const expr = parseCron("0 9-17 * * *");
		assert.deepEqual(expr.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
	});

	it("parses a comma list", () => {
		const expr = parseCron("0 9,12,17 * * *");
		assert.deepEqual(expr.hours, [9, 12, 17]);
	});

	it("parses weekday range", () => {
		const expr = parseCron("0 9 * * 1-5");
		assert.deepEqual(expr.weekdays, [1, 2, 3, 4, 5]);
	});

	it("parses range with step", () => {
		const expr = parseCron("0 0 1-31/7 * *");
		assert.deepEqual(expr.days, [1, 8, 15, 22, 29]);
	});

	it("throws on wrong number of fields", () => {
		assert.throws(() => parseCron("* * *"), /5 fields/);
	});

	it("throws on out-of-range value", () => {
		assert.throws(() => parseCron("60 * * * *"), /out of range/);
	});

	it("throws on invalid step", () => {
		assert.throws(() => parseCron("*/0 * * * *"), /Invalid step/);
	});
});

describe("matchesCron", () => {
	it("matches the exact minute/hour", () => {
		const expr = parseCron("30 14 * * *");
		const date = new Date("2025-01-15T14:30:00");
		assert.equal(matchesCron(expr, date), true);
	});

	it("does not match wrong minute", () => {
		const expr = parseCron("30 14 * * *");
		const date = new Date("2025-01-15T14:31:00");
		assert.equal(matchesCron(expr, date), false);
	});

	it("matches weekday constraint", () => {
		const expr = parseCron("0 9 * * 1"); // Monday only
		const monday = new Date("2025-01-06T09:00:00"); // Jan 6 2025 is Monday
		const tuesday = new Date("2025-01-07T09:00:00");
		assert.equal(matchesCron(expr, monday), true);
		assert.equal(matchesCron(expr, tuesday), false);
	});

	it("matches step minutes", () => {
		const expr = parseCron("*/15 * * * *");
		assert.equal(matchesCron(expr, new Date("2025-01-01T10:00:00")), true);
		assert.equal(matchesCron(expr, new Date("2025-01-01T10:15:00")), true);
		assert.equal(matchesCron(expr, new Date("2025-01-01T10:07:00")), false);
	});
});

describe("nextFireMs", () => {
	it("returns ms until next fire", () => {
		const expr = parseCron("*/5 * * * *");
		// Start at :02 — next fire is at :05, so 3 minutes away
		const from = new Date("2025-01-01T10:02:00");
		const ms = nextFireMs(expr, from);
		assert.equal(ms, 3 * 60 * 1000);
	});

	it("wraps correctly past the hour", () => {
		const expr = parseCron("5 * * * *"); // fires at :05 every hour
		const from = new Date("2025-01-01T10:06:00"); // just missed :05
		const ms = nextFireMs(expr, from);
		// Next fire is at 11:05, which is 59 minutes away
		assert.equal(ms, 59 * 60 * 1000);
	});

	it("fires at next whole minute boundary", () => {
		const expr = parseCron("0 * * * *"); // top of every hour
		const from = new Date("2025-01-01T10:59:00");
		const ms = nextFireMs(expr, from);
		assert.equal(ms, 60 * 1000); // 1 minute away
	});
});
