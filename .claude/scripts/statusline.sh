#!/usr/bin/env bash
# Claude Code Status Line
# Shows: user, directory, git branch (dirty indicator), context remaining %, model, time, todo count

set -euo pipefail

# Read JSON from stdin
INPUT=$(cat)

# Extract fields from JSON input
MODEL=$(echo "$INPUT" | grep -o '"display_name":"[^"]*"' | head -1 | cut -d'"' -f4)
CURRENT_DIR=$(echo "$INPUT" | grep -o '"current_dir":"[^"]*"' | head -1 | cut -d'"' -f4)
REMAINING_PCT=$(echo "$INPUT" | grep -o '"remaining_percentage":[0-9.]*' | head -1 | cut -d':' -f2)

# User
USER_NAME=$(whoami 2>/dev/null || echo "user")

# Directory (basename only)
DIR_NAME=$(basename "${CURRENT_DIR:-$(pwd)}" 2>/dev/null || echo "~")

# Git branch + dirty indicator
GIT_BRANCH=""
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "")
  if [ -n "$BRANCH" ]; then
    DIRTY=""
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
      DIRTY="*"
    fi
    GIT_BRANCH="${BRANCH}${DIRTY}"
  fi
fi

# Context remaining (round to integer)
CTX=""
if [ -n "${REMAINING_PCT:-}" ]; then
  CTX_INT=$(printf "%.0f" "$REMAINING_PCT" 2>/dev/null || echo "$REMAINING_PCT")
  CTX="ctx:${CTX_INT}%"
fi

# Model (short name)
MODEL_SHORT="${MODEL:-unknown}"

# Time
TIME_NOW=$(date +%H:%M)

# Todo count (count in-progress + pending from todo files if available)
TODO_COUNT=""
if [ -f "${CURRENT_DIR:-.}/.todos.json" ] 2>/dev/null; then
  COUNT=$(grep -c '"pending"\|"in_progress"' "${CURRENT_DIR}/.todos.json" 2>/dev/null || echo "0")
  if [ "$COUNT" -gt 0 ]; then
    TODO_COUNT="todo:${COUNT}"
  fi
fi

# Build output
PARTS=()
PARTS+=("${USER_NAME}:${DIR_NAME}")
[ -n "$GIT_BRANCH" ] && PARTS+=("$GIT_BRANCH")
[ -n "$CTX" ] && PARTS+=("$CTX")
PARTS+=("$MODEL_SHORT")
PARTS+=("$TIME_NOW")
[ -n "$TODO_COUNT" ] && PARTS+=("$TODO_COUNT")

echo "${PARTS[*]}"
