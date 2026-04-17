#!/usr/bin/env bash
#
# greenlight — Claude Code PostToolUse hook
# ------------------------------------------
# Runs `greenlight check` whenever the agent edits a todo.md file.
# If any newly-flipped checkbox fails its verifier, greenlight reverts it
# and this hook exits with code 2, which Claude Code treats as a "block"
# and feeds stderr back to the agent so it can retry.
#
# Install:
#   1. Make this file executable: chmod +x claude-code-posttooluse.sh
#   2. Reference it from your Claude Code settings:
#        ~/.claude/settings.json (global) or .claude/settings.json (project)
#      Example:
#        {
#          "hooks": {
#            "PostToolUse": [
#              {
#                "matcher": "Edit|Write",
#                "hooks": [
#                  { "type": "command", "command": "/abs/path/to/claude-code-posttooluse.sh" }
#                ]
#              }
#            ]
#          }
#        }
#
# Requires:
#   - greenlight on PATH (npm i -g greenlight)
#   - jq on PATH (for parsing the hook payload)

set -u

payload="$(cat)"

# Parse tool name and file path from the hook payload.
tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty')"
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')"

# We only care about edits to a todo.md file.
case "$tool_name" in
  Edit|MultiEdit|Write) ;;
  *) exit 0 ;;
esac

case "$(basename "$file_path")" in
  todo.md|TODO.md) ;;
  *) exit 0 ;;
esac

# Run greenlight in the directory of the edited todo.md.
work_dir="$(dirname "$file_path")"
cd "$work_dir" || exit 0

if ! command -v greenlight >/dev/null 2>&1; then
  echo "greenlight hook: 'greenlight' is not on PATH — install with 'npm i -g greenlight'" >&2
  exit 0
fi

if greenlight check "$(basename "$file_path")"; then
  exit 0
fi

# A verifier failed. Exit 2 tells Claude Code to block the turn and surface
# stderr back to the agent as feedback. The agent will then see the
# failure output and retry.
cat >&2 <<'EOF'

⛔ greenlight: one or more contract verifiers failed.

Fix the underlying problem, then let me know so I can re-run the check.
Do not re-check the todo until the verifier passes.
EOF
exit 2
