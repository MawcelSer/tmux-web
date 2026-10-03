# Code Review

Run a comprehensive code review on recent changes.

## Steps

1. Launch the **code-reviewer** agent
2. Identify all modified files (via git diff or specified files)
3. Review each file against project rules:
   - `rules/coding-style.md` — style and quality
   - `rules/security.md` — security checklist
   - `rules/testing.md` — test coverage
4. Categorize findings: CRITICAL > HIGH > MEDIUM > LOW
5. Present findings with file:line references and fix suggestions

## Arguments

$ARGUMENTS: Optional — specific files or scope to review (defaults to all recent changes)

## Usage

```
/code-review
/code-review src/auth/
/code-review --staged
```
