# greenlight

> **Eval-gated todos for agentic coding.**
> Your agents can't tick the checkbox until the verifier passes.

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-blue.svg)](#)
[![v0.8.0](https://img.shields.io/badge/version-v0.8.0-brightgreen.svg)](#roadmap)

---

Multi-agent coding is getting real. Claude Code subagents, Codex, Octogent,
OpenHarness — they all let you run *more* agents in parallel. The problem nobody
has solved is that **more agents means more plausible-looking output that's actually
wrong.** The completion signal today is "the agent said it was done," which scales
terribly.

`greenlight` fixes that with one primitive: **a todo item can't be flipped to `[x]`
until its attached verifier exits `0`.**

Zero runtime dependencies. Plain markdown. Plugs into any agent or CI pipeline.

---

## 30-second demo

Your `todo.md`:

```markdown
- [ ] Implement add(a, b)
  - eval: `npm run test:add`
  - retries: 2

- [ ] Implement subtract(a, b)
  - eval: `npm run test:subtract`
  - retries: 3
```

Run `greenlight check`:

```
greenlight · checking 2 contracts in todo.md

  ▸ Implement add(a, b) (implement-add) ... ✓ passed (412ms)
  ▸ Implement subtract(a, b) (implement-subtract) ... ✗ failed (exit 1, 388ms)
    │ subtract
    │   ✖ expected 2, got 8
    │   at file:///.../subtract.test.js:6:10

Summary: 1 passed, 1 failed
```

`add` flips to `[x]`. `subtract` stays `[ ]` — and the failure output is right
there for the agent to read and retry.

---

## Why this matters

Today's agent orchestrators give you more workers. `greenlight` gives those workers
a **contract**: each todo is a unit of work with a built-in quality gate. That unlocks:

- **Auto-retries with context.** The agent sees the verifier output and fixes the root
  cause instead of re-asking the human.
- **Honest progress bars.** `[x]` means the tests actually passed.
- **Safe parallelism.** Spawn 8 workers on 8 todos; only the ones that actually work
  commit their checkboxes.
- **Budget enforcement per task.** Each contract declares its token budget; `greenlight`
  tracks spend and can report overruns.
- **24/7 autonomous operation.** Trigger contracts on a schedule, file change, or
  webhook — no human needed to kick things off.

---

## Install

```bash
# Global CLI
npm install -g greenlight

# Or clone + link for development
git clone https://github.com/jorgejac1/greenlight
cd greenlight
pnpm install && pnpm build && npm link
```

## Quick start

```bash
cd examples/basic
npm install
greenlight list          # show contracts + verifiers
greenlight check         # run pending verifiers, flip checkboxes
```

---

## Contract format

Contracts live in any markdown file (convention: `todo.md`). A contract is a GFM
task-list item with indented sub-bullet fields:

```markdown
- [ ] Refactor auth middleware to use JWT
  - eval: `pnpm test src/auth && pnpm lint src/auth`
  - retries: 3
  - budget: 50k
  - id: auth-jwt-refactor
  - provider: sonnet
  - role: worker
  - mcp: supabase, filesystem
  - on: schedule: "0 */6 * * *"
```

### Field reference

| Field       | Required | Description |
| ----------- | -------- | ----------- |
| `eval`      | yes*     | Shell command. Exit 0 = pass, anything else = fail. |
| `eval.all`  | yes*     | Pipe-separated commands — **all** must exit 0. |
| `eval.any`  | yes*     | Pipe-separated commands — **any one** must exit 0. |
| `eval.llm`  | yes*     | Natural-language prompt judged by Claude. Answers PASS or FAIL. |
| `retries`   | no       | Max retry attempts hint for orchestrators. |
| `budget`    | no       | Token budget: `50k`, `1.5m`, or raw integer. |
| `id`        | no       | Stable slug for references and logs. Defaults to slugified title. |
| `provider`  | no       | Preferred model: `opus`, `sonnet`, or `haiku`. |
| `role`      | no       | Agent role hint: `coordinator`, `worker`, or `linter`. |
| `mcp`       | no       | Comma-separated list of MCP servers this contract may use. |
| `on`        | no       | Trigger: `schedule: "<cron>"`, `watch: "<glob>"`, or `webhook: "<path>"`. |

\* Exactly one `eval` variant is required for a gated contract. Items without any `eval` are **ungated** — they behave like normal checkboxes.

### Verifier variants

**Shell** — a single command:
```markdown
- [ ] Tests pass
  - eval: `npm test`
```

**Composite all** — every step must exit 0:
```markdown
- [ ] Build and lint pass
  - eval.all: `npm run build` | `npm run lint` | `npm test`
```

**Composite any** — at least one step must exit 0:
```markdown
- [ ] At least one mirror is up
  - eval.any: `curl -f https://mirror-1/health` | `curl -f https://mirror-2/health`
```

**LLM judge** — Claude evaluates the output; useful for prose, API contracts, or anything hard to assert mechanically:
```markdown
- [ ] README explains the feature clearly
  - eval.llm: Does the README at ./README.md explain the auth flow in plain English?
```

Requires `ANTHROPIC_API_KEY`. Defaults to `claude-haiku-4-5-20251001`.

### Trigger variants

```markdown
# Run on a cron schedule
- on: schedule: "*/30 * * * *"

# Re-check when source files change
- on: watch: "src/**/*.ts"

# Fire when a webhook hits the daemon
- on: webhook: "/deploy-done"
```

---

## CLI reference

| Command | Description |
| ------- | ----------- |
| `greenlight check [path]` | Run verifiers on all pending contracts. |
| `greenlight list [path]` | List all contracts with status and verifier. |
| `greenlight retry <id> [path]` | Rerun a single contract, injecting last failure as context. |
| `greenlight log [path]` | Show run history. Flags: `--contract=<id>`, `--failed`, `--limit=N`. |
| `greenlight msg send <from> <to> <kind> [payload-json] [path]` | Send a structured message between agents. |
| `greenlight msg list [path]` | List messages. Flags: `--to=<agent>`, `--kind=<kind>`. |
| `greenlight serve [cwd]` | Start the MCP server on stdio. |
| `greenlight watch [path]` | Start the trigger daemon (schedule / watch / webhook). |
| `greenlight ui [path] [--port=N]` | Launch web dashboard at `localhost:7777`. |
| `greenlight dash [path]` | ANSI terminal dashboard — live contract status. |
| `greenlight budget [path]` | Show token spend vs budget per contract. |
| `greenlight budget <id> <tokens> [path]` | Record token usage for a contract. |
| `greenlight suggest "<title>" [path]` | Find similar past completions for a new contract. |
| `greenlight patterns [path]` | Analyse failure patterns across all contracts. |
| `greenlight export [path] [--format=json\|md]` | Export full project snapshot. |
| `greenlight diff <snap1.json> <snap2.json> [--format=text\|json\|md]` | Compare two snapshots — show what changed between exports. |

---

## Claude Code integration

Wire the provided `PostToolUse` hook to auto-check `todo.md` whenever Claude Code
edits it:

```bash
chmod +x hooks/claude-code-posttooluse.sh
```

Add to `~/.claude/settings.json` (or `.claude/settings.json` in your repo):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "/abs/path/to/hooks/claude-code-posttooluse.sh" }
        ]
      }
    ]
  }
}
```

Now whenever Claude Code edits `todo.md`, `greenlight check` runs automatically.
If a verifier fails, the hook exits `2` and Claude Code feeds the failure output
back into the agent's next turn.

---

## MCP integration

`greenlight serve` exposes 15 tools over stdio MCP. Any MCP client (Claude Desktop,
Cursor, Windsurf) can invoke contracts as tools without touching the CLI.

### Add to Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "greenlight": {
      "command": "greenlight",
      "args": ["serve", "/path/to/your/project"]
    }
  }
}
```

### MCP tools

| Tool | Description |
| ---- | ----------- |
| `list_all` | All contracts with status. |
| `list_pending` | Contracts not yet passing. |
| `list_triggers` | Contracts with `on:` triggers and their next fire time. |
| `run_eval` | Run a single contract by id. |
| `check_all` | Run all pending contracts. |
| `get_retry_context` | Get last failure output formatted as a retry prompt. |
| `get_run_history` | Full run log, filterable by contract or status. |
| `get_last_failure` | Last failure details for a contract. |
| `send_message` | Send a structured agent message. |
| `list_messages` | List messages, filterable by recipient or kind. |
| `get_provider_hints` | Provider and role hints for all contracts. |
| `report_token_usage` | Record token spend for a contract. |
| `suggest_template` | Find similar past completions for a new task. |
| `get_patterns` | Failure pattern analysis across all contracts. |
| `export_state` | Full project snapshot as JSON or markdown. |

---

## Triggers

Start the trigger daemon with `greenlight watch`. It handles three trigger kinds:

**Schedule** — cron expression, runs the contract verifier at the specified interval:
```markdown
- [ ] Sync exchange rates
  - eval: `node scripts/sync-rates.js`
  - on: schedule: "0 * * * *"
```

**Watch** — glob pattern, re-checks when matching files change:
```markdown
- [ ] Auth tests must pass
  - eval: `pnpm test src/auth`
  - on: watch: "src/auth/**"
```

**Webhook** — HTTP endpoint, fires when a POST hits the daemon:
```markdown
- [ ] Deploy smoke test
  - eval: `./scripts/smoke-test.sh staging`
  - on: webhook: "/deploy-done"
```

The webhook server listens on `localhost:7778` by default.

---

## Agent messaging

Agents in a multi-worker setup can exchange structured messages through greenlight's
message bus. Messages persist to `.greenlight/messages.ndjson`.

```bash
# Coordinator tells worker-2 the schema is ready
greenlight msg send coordinator worker-2 schema_ready '{"table":"users"}'

# Worker lists its inbox
greenlight msg list --to=worker-2

# Or via MCP
send_message({ from: "coordinator", to: "worker-2", kind: "schema_ready", payload: {...} })
list_messages({ to: "worker-2" })
```

Message envelopes carry `from`, `to`, `kind`, `payload`, and a `correlation_id` for
tracing request/response pairs across turns.

---

## Budget tracking

Declare a token budget on any contract. Workers report their spend; greenlight tracks
cumulative usage and warns on overrun.

```markdown
- [ ] Generate migration SQL
  - eval: `pnpm db:validate`
  - budget: 50k
  - id: gen-migration
```

```bash
# Worker reports spend after its turn
greenlight budget gen-migration 12400

# See all contracts vs budget
greenlight budget
#   gen-migration   12,400 / 50,000   24%
#   auth-refactor   61,200 / 50,000   122%  ⚠ over budget
```

The `report_token_usage` MCP tool lets agents self-report without shelling out.

---

## Web UI and terminal dashboard

```bash
# Browser dashboard at localhost:7777
greenlight ui

# Custom port
greenlight ui --port=8080

# ANSI live dashboard in the terminal
greenlight dash
```

The web UI shows live contract status, run history, failure output, and budget gauges.
The ANSI dashboard is useful inside tmux or when you want a heads-up display without
leaving the terminal.

---

## Memory and learning

greenlight indexes successful contract completions so future contracts can get a
head start:

```bash
# Find templates similar to a new task
greenlight suggest "migrate users table to Postgres"
#   85% match: migrate_products_table — passed in 1 attempt
#   72% match: migrate_orders_table   — passed in 2 attempts, retries=3

# See failure patterns across all contracts
greenlight patterns
#   Most common failure: exit 1 in test:subtract — 8 occurrences
#   Fastest to fix after failure: lint contracts — avg 1.2 retries
```

The `suggest_template` and `get_patterns` MCP tools expose the same data to agents
directly, so they can self-tune without human intervention.

---

## Persistence

All state lives in `.greenlight/` at the project root:

```
.greenlight/
  runs.ndjson       — full run history (contract id, exit code, output, duration)
  messages.ndjson   — agent message log
  budget.ndjson     — token spend per contract
```

NDJSON format — human-readable, grep-friendly, no database required.

---

## Programmatic API

```ts
import { parseTodo, runContract, updateTodo } from "greenlight";
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("todo.md", "utf8");
const contracts = parseTodo(src);

const results = [];
for (const c of contracts.filter((c) => !c.checked && c.verifier)) {
  results.push(await runContract(c, process.cwd()));
}

writeFileSync("todo.md", updateTodo(src, results));
```

Full export surface:

```ts
// Core
import { parseTodo, runContract, runShell, updateTodo } from "greenlight";

// Persistence
import { appendRun, queryRuns, getLastFailure, getLastRun, onRun } from "greenlight";
import { sendMessage, listMessages } from "greenlight";
import { reportTokenUsage, queryBudgetRecords, getTotalTokens, getBudgetSummary } from "greenlight";

// Memory + analysis
import { suggest, detectPatterns, exportSnapshot, snapshotToMarkdown, diffSnapshots, diffToMarkdown } from "greenlight";

// Servers
import { startMcpServer, startUiServer, startWatcher, startDash } from "greenlight";

// Cron helpers
import { parseCron, matchesCron, nextFireMs } from "greenlight";
```

---

## Other integrations

### Codex / any CLI / git hooks

`greenlight check` is provider-agnostic. Wire it anywhere a shell command runs:

```bash
# post-commit hook inside a worktree
greenlight check todo.md || echo "Contracts failed — review before merging."
```

### CI (GitHub Actions)

```yaml
- name: Check greenlight contracts
  run: npx greenlight check
```

---

## Roadmap

All v0.1 through v0.8 milestones have shipped.

| Version | Feature | Status |
| ------- | ------- | ------ |
| v0.1 | Parser, shell verifier, CLI (`check`, `list`), Claude Code hook | Shipped |
| v0.2 | MCP server (15 tools), `greenlight serve` | Shipped |
| v0.3 | Triggers (`schedule`, `watch`, `webhook`), `greenlight watch` | Shipped |
| v0.4 | Durable run log, structured agent messaging, `greenlight retry` | Shipped |
| v0.5 | Web UI (`greenlight ui`), ANSI dashboard (`greenlight dash`) | Shipped |
| v0.6 | Budget tracking, provider/role hints, MCP-scoped contracts | Shipped |
| v0.7 | Memory/learning (`suggest`, `patterns`), `export`, failure analysis | Shipped |
| v0.8 | Composite verifiers (`eval.all`, `eval.any`), LLM-judge (`eval.llm`), `diff`, GitHub Actions CI, Biome linter, pre-commit hook | Shipped |

**Up next:**
- `--watch` mode for continuous re-checking on file save
- Semantic-diff verifier kind (assert structural changes, not just exit codes)
- MCP per-contract server scoping (whitelist which servers each worker can reach)
- `greenlight retry <id>` with automatic failure-context injection
- Vector-indexed template memory for smarter `suggest` results

---

## Prior art and positioning

- **Octogent / OpenHarness** — orchestrate multiple Claude Code sessions.
  `greenlight` slots underneath them as the quality-gate layer they're missing.
- **promptfoo / braintrust** — eval LLM outputs at the prompt level.
  `greenlight` evals *agent-produced changes* at the task level.
- **Claude Code native subagents** — invisible spawning, no quality gate.
  `greenlight` contracts are plain markdown you can read, edit, and version.

```
greenlight          ← primitive, no deps, quality gate layer
    ↑
Octogent            ← orchestrator, Claude Code only
OpenHarness         ← full harness, multi-provider
Your 24/7 setup     ← uses Claude Code + greenlight for gates
```

---

## Contributing

PRs welcome. Keep the zero-dependency constraint — it's a hard rule, not a preference.
New verifier kinds belong in `types.ts` first, then `verifier.ts`, then a test.
The parser is the most critical file; edge cases matter more than features.

### Development setup

```bash
pnpm install       # install dev deps (typescript, tsx, biome)
pnpm build         # compile TypeScript → dist/
pnpm test          # run all unit tests (67 tests)
pnpm typecheck     # TypeScript strict check, no emit
pnpm lint          # biome lint check (src/ and test/)
pnpm lint:fix      # auto-fix lint issues
```

A **pre-commit hook** runs `typecheck` + `lint` automatically on every commit.
If it blocks, run `pnpm lint:fix` to auto-fix, then re-stage.

### Adding a verifier kind

1. Add the interface to `src/types.ts` and union it into `Verifier`
2. Handle it in `src/parser.ts` (`buildVerifier`)
3. Handle it in `src/verifier.ts` (`runContract`)
4. Add tests in `test/parser.test.ts` and a new `test/<kind>.test.ts`
5. Export from `src/index.ts`

---

## License

MIT
