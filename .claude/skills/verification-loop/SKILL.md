# Verification Loop

## Description

Continuous verification skill — runs iterative checks (build, test, lint, type-check) in a loop until everything passes.

## When to Use

- Via `/verify` command
- Before pushing or creating PRs
- After significant refactoring

## Loop Process

1. **Test** — Run test suite
2. **Build** — Run build command
3. **Lint** — Run linter
4. **Types** — Run type checker (if applicable)
5. **Evaluate** — If any step failed:
   - Analyze the failure
   - Apply fix
   - Return to step 1
6. **Report** — All green → report success

## Termination Conditions

- All checks pass → success
- Max 5 iterations reached → report remaining failures
- Same error persists after 3 attempts → escalate

## Pre-Push Hook

Catch lint/format issues locally before they reach CI. Zero-dependency setup using tracked `.githooks/`:

1. `.githooks/pre-push` — runs `pnpm lint && pnpm format:check`
2. `"prepare": "git config core.hooksPath .githooks"` in package.json
3. Activated on `pnpm install` for all contributors

## Principles

- Fix one issue at a time
- Re-run ALL checks after each fix (not just the failed one)
- Prefer minimal fixes over sweeping changes
- Always run lint locally before pushing (pre-push hook enforces this)
