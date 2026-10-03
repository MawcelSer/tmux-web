#!/bin/bash
# PreToolUse hook for Bash: block long-running servers, warn on git push
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Command boundary: start of string or after ; & | ( or whitespace
B='(^|[;&|(][[:space:]]*|[[:space:]])'
# End of a command word: end of string, whitespace, or ; & | )
E='($|[[:space:];&|)])'

# Block servers that never exit — they must run in tmux for log access.
# Matches `npm run dev`, `npm start`, `node server/index.js`, `vite` / `npx vite`
# (dev / serve / preview), but NOT `vitest`, `vite build` or `vite.config.js`.
DEV_SERVER_RE="${B}((npm|pnpm|yarn|bun) (run )?(dev|preview)${E}|node server/index\.js${E}|(npx )?vite([[:space:]]+(dev|serve|preview))?${E})"

IN_TMUX_RE='^[[:space:]]*tmux[[:space:]]+(new|new-session|new-window|split-window|send-keys)([[:space:]]|$)'

if echo "$CMD" | grep -qE "$DEV_SERVER_RE" \
  && ! echo "$CMD" | grep -qE "${B}(npx )?vite[[:space:]]+build" \
  && ! echo "$CMD" | grep -qE "$IN_TMUX_RE"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Dev server must run in tmux for log access. Use: tmux new -s dev"
    }
  }'
  exit 0
fi

# Warn about git push
if echo "$CMD" | grep -qE "${B}git push${E}"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "Review changes before pushing. Have you run /verify and /code-review?"
    }
  }'
  exit 0
fi

exit 0
