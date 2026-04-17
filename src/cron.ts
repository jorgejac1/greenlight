/**
 * Minimal 5-field cron engine — zero dependencies.
 *
 * Supports: * wildcard, step (star/n), exact value, range (a-b), list (a,b,c)
 * Fields:   minute hour day-of-month month day-of-week
 * Does NOT support: L, W, #, named months/weekdays, 6-field (seconds) expressions
 *
 * Examples:
 *   "0 2 * * *"      every day at 02:00
 *   "@every30min"    every 30 minutes — use "star/30 * * * *"
 *   "0 9-17 * * 1-5" weekdays 09:00-17:00 on the hour
 */

export interface CronExpr {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
}

/**
 * Parse a 5-field cron string into a CronExpr.
 * Throws if the expression is invalid.
 */
export function parseCron(expr: string): CronExpr {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): "${expr}"`);
  }
  const [min, hour, day, month, weekday] = fields;
  return {
    minutes:  expandField(min,     0, 59),
    hours:    expandField(hour,    0, 23),
    days:     expandField(day,     1, 31),
    months:   expandField(month,   1, 12),
    weekdays: expandField(weekday, 0,  6),
  };
}

/**
 * Returns true if the given Date matches the cron expression.
 * Month is 1-indexed; weekday 0=Sunday, 6=Saturday.
 */
export function matchesCron(expr: CronExpr, date: Date): boolean {
  return (
    expr.minutes.includes(date.getMinutes()) &&
    expr.hours.includes(date.getHours()) &&
    expr.days.includes(date.getDate()) &&
    expr.months.includes(date.getMonth() + 1) &&
    expr.weekdays.includes(date.getDay())
  );
}

/**
 * Returns the number of milliseconds until the next cron fire after `from`.
 * Scans forward minute by minute up to 366 days.
 * Returns Infinity if no match found (shouldn't happen with valid expressions).
 */
export function nextFireMs(expr: CronExpr, from: Date = new Date()): number {
  // Start at the next whole minute
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);

  while (candidate < limit) {
    if (matchesCron(expr, candidate)) {
      return candidate.getTime() - from.getTime();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return Infinity;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function expandField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    // */n — step over full range
    const stepWildcard = part.match(/^\*\/(\d+)$/);
    if (stepWildcard) {
      const step = parseInt(stepWildcard[1], 10);
      if (step < 1) throw new Error(`Invalid step in cron field: "${part}"`);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }

    // * — wildcard
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    // a-b/n — range with step
    const rangeStep = part.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (rangeStep) {
      const [, a, b, s] = rangeStep.map(Number);
      for (let i = a; i <= b; i += s) {
        if (i >= min && i <= max) values.add(i);
      }
      continue;
    }

    // a-b — range
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const [, a, b] = range.map(Number);
      for (let i = a; i <= b; i++) {
        if (i >= min && i <= max) values.add(i);
      }
      continue;
    }

    // n — single value
    const n = parseInt(part, 10);
    if (!isNaN(n)) {
      if (n < min || n > max) {
        throw new Error(`Cron value ${n} out of range [${min}-${max}] in field "${field}"`);
      }
      values.add(n);
      continue;
    }

    throw new Error(`Invalid cron field part: "${part}"`);
  }

  return Array.from(values).sort((a, b) => a - b);
}
