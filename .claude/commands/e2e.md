# E2E

Run end-to-end tests and fix failures.

## Steps

1. Detect the E2E testing framework (Playwright, Cypress, etc.)
2. verify that all uncommitted changes are covered by e2e tests
3. Run the E2E test suite
4. Analyze any failures:
   - Read error output and screenshots/traces
   - Identify root cause (UI change, API change, timing issue)
5. Fix failures incrementally
6. Re-run to verify fixes
7. Report results

## Arguments

$ARGUMENTS: Optional — specific test file or suite to run

## Usage

```
/e2e
/e2e tests/e2e/auth.spec.ts
/e2e --headed
```
