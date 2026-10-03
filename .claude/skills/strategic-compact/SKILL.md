# Strategic Compact

## Description

Smart context compaction — decides what to preserve and what to drop when compacting context. Prioritizes recent decisions and active task state over older exploration.

## When to Use

- Automatically via `suggest-compact.js` hook after threshold tool calls
- Manually when context feels stale or cluttered
- At logical phase transitions (exploration → implementation)

## Compaction Strategy

### Preserve (High Priority)
- Current task and todo list
- Active file paths and recent changes
- Key decisions and their rationale
- Error context if debugging
- Test results from current session

### Drop (Low Priority)
- Exploratory file reads from early in session
- Failed approaches that were abandoned
- Verbose output from build/test runs
- Intermediate search results

## Principles

- Compact at phase boundaries, not mid-task
- Always save state before compacting (pre-compact hook handles this)
- After compacting, re-read critical files if needed
