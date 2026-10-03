#!/bin/bash
# PostToolUse hook for Bash: notify on PR creation
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$CMD" | grep -q 'gh pr create'; then
  echo '[Hook] PR created. Review with: gh pr view --web'
fi

exit 0
