# Verify

Run a comprehensive verification loop: tests, build, lint, and type checking.

## Steps

1. Run the test suite — all tests must pass
2. Run the build — must compile successfully
3. Run the linter — no errors allowed
4. Run type checking (if applicable) — no type errors
5. Run Prettier format check — `npx prettier --check 'src/**/*.{ts,tsx}'`
6. If any step fails:
   - Analyze the failure
   - Fix the issue
   - Re-run from step 1
7. Report final status

## Arguments

$ARGUMENTS: Optional — skip specific checks (e.g., `--skip-e2e`)

## Usage

```
/verify
/verify --skip-e2e
```
