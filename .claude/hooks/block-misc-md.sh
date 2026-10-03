#!/bin/bash
# PreToolUse hook for Write: block miscellaneous markdown files
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if echo "$FILE" | grep -qE '\.md$'; then
  if ! echo "$FILE" | grep -qE '(CLAUDE\.md|README\.md|SKILL\.md|PULL_REQUEST_TEMPLATE\.md|rules/|commands/|agents/|contexts/|skills/|plugins/|docs/|plans/|memory/)'; then
    echo "Avoid creating miscellaneous markdown files. Use designated documentation directories." >&2
    exit 2
  fi
fi

exit 0
