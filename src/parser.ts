import type { Contract, Verifier } from "./types.js";

const CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.*)$/;
const SUB_BULLET_RE = /^(\s+)-\s+([a-zA-Z][\w-]*)\s*:\s*(.*)$/;

/**
 * Parse a todo.md source into a list of Contracts.
 *
 * Format:
 *   - [ ] Title of the task
 *     - eval: `shell command`
 *     - retries: 3
 *     - budget: 50k
 *     - id: optional-stable-id
 */
export function parseTodo(source: string): Contract[] {
  const lines = source.split("\n");
  const contracts: Contract[] = [];

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(CHECKBOX_RE);
    if (!m) {
      i++;
      continue;
    }

    const [, indent, checkMark, rawTitle] = m;
    const baseIndent = indent.length;
    const title = rawTitle.trim();
    const rawLines: number[] = [i];
    const fields: Record<string, string> = {};

    let j = i + 1;
    while (j < lines.length) {
      const sub = lines[j].match(SUB_BULLET_RE);
      if (!sub) break;
      const [, subIndent, key, value] = sub;
      // Sub-bullet must be indented MORE than the checkbox line.
      if (subIndent.length <= baseIndent) break;
      fields[key.toLowerCase()] = stripBackticks(value.trim());
      rawLines.push(j);
      j++;
    }

    const checked = checkMark.toLowerCase() === "x";
    const id = fields.id || slugify(title) || `item-${i}`;

    contracts.push({
      id,
      title,
      checked,
      status: checked ? "passed" : "pending",
      verifier: buildVerifier(fields),
      retries: fields.retries ? parseInt(fields.retries, 10) : undefined,
      budget: fields.budget ? parseBudget(fields.budget) : undefined,
      line: i,
      rawLines,
    });

    i = j;
  }

  return contracts;
}

function buildVerifier(fields: Record<string, string>): Verifier | undefined {
  if (!fields.eval) return undefined;
  return { kind: "shell", command: fields.eval };
}

function stripBackticks(s: string): string {
  const m = s.match(/^`(.+)`$/);
  return m ? m[1] : s;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseBudget(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return parseInt(s, 10) || 0;
  const n = parseFloat(m[1]);
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") return Math.round(n * 1_000);
  if (suffix === "m") return Math.round(n * 1_000_000);
  return Math.round(n);
}
