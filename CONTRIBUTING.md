# Contributing to greenlight

Thanks for the interest. A few principles keep this project healthy.

## Scope

greenlight is a **primitive**, not a framework. The value is that it does
one small thing well and composes with everything else.

**In scope:**

- Parser improvements, edge cases, better error messages.
- New verifier kinds (`composite`, `llm-judge`, `semantic-diff`).
- Hook / integration scripts for other agents (Cursor, Windsurf, Aider, Codex).
- MCP server (v0.2).
- Trigger system (v0.3): cron, webhooks, git events.

**Out of scope:**

- A dashboard / web UI.
- An orchestrator. (Use Octogent or OpenHarness; greenlight plugs into them.)
- Anything that tries to replace Claude Code, Codex, or an MCP client.
- LLM provider abstractions.

If you're unsure, open an issue first.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Run the example end-to-end:

```bash
cd examples/basic
npm install
../../dist/cli.js check
```

## Code style

- No runtime dependencies. The whole point is that greenlight is a thin,
  trusted primitive. Dev dependencies are fine.
- TypeScript strict mode. No `any` without a comment justifying it.
- Prefer Node built-ins over packages.
- One clear idea per PR.

## Commits

Conventional commits are appreciated but not required. A good commit message
explains *why*, not what.
