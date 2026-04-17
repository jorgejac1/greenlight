# greenlight

> **Eval-gated todos for agentic coding.**
> Your agents can't tick the checkbox until the verifier passes.

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-blue.svg)](#)
[![v0.1](https://img.shields.io/badge/status-v0.1%20preview-orange.svg)](#roadmap)

---

Multi-agent coding is getting real. Claude Code subagents, Codex, Octogent,
OpenHarness — they all let you run *more* agents in parallel. The problem
nobody has solved is that **more agents means more plausible-looking output
that's actually wrong.** The completion signal today is "the agent said it
was done," which scales terribly.

`greenlight` fixes that with one primitive: **a todo item can't be flipped
to `[x]` until its attached verifier exits `0`.**

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

## Why this matters

Today's agent orchestrators (Octogent, OpenHarness, Claude Code subagents) give
you more workers. `greenlight` gives those workers a **contract**: each todo is
a unit of work with a built-in quality gate. That unlocks:

- **Auto-retries with context.** The agent sees the verifier output and fixes
  the root cause instead of re-asking the human.
- **Honest progress bars.** `[x]` means the tests actually passed.
- **Safe parallelism.** Spawn 8 workers on 8 todos; only the ones that
  actually work will commit their checkboxes.
- **Budget limits per task.** The contract declares its token budget; the
  orchestrator can enforce it.

## Install

```bash
# npm
npm install -g greenlight

# Or clone + link for development
git clone https://github.com/YOURUSER/greenlight
cd greenlight
pnpm install && pnpm build && npm link
```

## Quick start

```bash
cd examples/basic
npm install
greenlight list         # show contracts + verifiers
greenlight check        # run pending verifiers, flip checkboxes
```

## Contract format

Contracts live inside any markdown file (convention: `todo.md`). A contract is
a GFM task-list item with indented sub-bullet fields:

```markdown
- [ ] Refactor auth middleware to use JWT
  - eval: `pnpm test src/auth && pnpm lint src/auth`
  - retries: 3
  - budget: 50k
  - id: auth-jwt-refactor
```

| Field     | Required | Meaning                                                  |
| --------- | -------- | -------------------------------------------------------- |
| `eval`    | yes      | Shell command; exit 0 = pass, anything else = fail       |
| `retries` | no       | Max retries the orchestrator should allow after a fail   |
| `budget`  | no       | Token budget hint (`50k`, `1.5m`, or raw integer)        |
| `id`      | no       | Stable slug; defaults to a slugified title               |

Items without an `eval` field are **ungated** — they behave like normal
checkboxes. Only items with a verifier are contracts.

## Integrations

### Claude Code

Wire the provided `PostToolUse` hook to auto-check `todo.md` edits:

```bash
chmod +x hooks/claude-code-posttooluse.sh
```

Then in `~/.claude/settings.json` (or `.claude/settings.json` in your repo):

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

Now whenever Claude Code edits `todo.md`, greenlight runs the verifiers.
If one fails, the hook exits `2` and Claude Code feeds the failure output
back into the agent's next turn automatically.

### Codex / any CLI / any worktree

`greenlight check` is provider-agnostic. It reads `todo.md` and runs shell
commands. Wire it to a `post-commit` git hook, a file watcher, or your CI:

```bash
# post-commit hook, inside a worktree
greenlight check todo.md || echo "⚠️  Contracts failed — review before merging."
```

### MCP (v0.2, planned)

`greenlight` will expose an MCP server so Claude Desktop, Cursor, Windsurf,
and any other MCP client can invoke contracts as tools:

```
tools:
  - run_eval(contract_id)          -> RunResult
  - list_pending()                 -> Contract[]
  - check_all()                    -> RunResult[]
  - get_retry_context(contract_id) -> string   # formatted failure prompt
```

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

## Roadmap

- **v0.1** — parser, shell verifier, CLI (`check`, `list`), Claude Code hook.
  *(You are here.)*
- **v0.2** — MCP server. Composite verifiers (`all:`, `any:`). `--watch` mode.
- **v0.3** — Triggers (`cron`, `webhook`, `on_pr_open`). Makes 24/7 agent
  setups actually possible.
- **v0.4** — Durable event log (Postgres or SQLite). Structured message
  envelopes between agents. Retry-with-context loop as a first-class primitive.

The goal for each release is **one clean idea, shippable, with a gif.**

## Prior art & positioning

- **Octogent / OpenHarness** — orchestrate multiple Claude Code sessions.
  `greenlight` slots underneath them as the quality-gate layer they're missing.
- **promptfoo / braintrust** — eval LLM outputs. `greenlight` evals
  *agent-produced changes* at the task granularity, not the prompt granularity.
- **Claude Code native subagents** — invisible spawning. `greenlight`
  contracts are plain markdown, so you can see and edit them.

## Contributing

PRs welcome. Keep v0.1 scope tight — new verifier kinds, parser edge cases,
and hook integrations for other agents (Cursor, Windsurf, Aider) are in scope.
Frameworks and dashboards are not.

## License

MIT
