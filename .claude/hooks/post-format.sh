#!/bin/bash
# PostToolUse hook for Write|Edit: run prettier on JS/TS files
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Run prettier on JS/TS files
if echo "$FILE" | grep -qE '\.(js|jsx|ts|tsx)$'; then
  "$CLAUDE_PROJECT_DIR"/node_modules/.bin/prettier --write "$FILE" >/dev/null 2>&1 || true
fi

exit 0
