# TDD Workflow

## Description

Complete test-driven development workflow implementing the RED-GREEN-REFACTOR cycle.

## When to Use

- Implementing new features
- Fixing bugs
- Adding to existing functionality
- Via `/tdd` command

## Workflow

### RED Phase
1. Write a test that describes the desired behavior
2. Run the test — it MUST fail
3. If it passes, the test is wrong or the feature already exists

### GREEN Phase
1. Write the MINIMUM code to make the test pass
2. Don't optimize, don't add extra features
3. Run the test — it MUST pass

### REFACTOR Phase
1. Clean up the implementation
2. Remove duplication
3. Improve naming
4. Run ALL tests — they MUST still pass

### Coverage Check
1. Run coverage report
2. Verify ≥ 80% coverage
3. Add tests for uncovered paths if needed

## Principles

- One test at a time
- Smallest possible increments
- Fix the implementation, not the tests
- Tests should be independent and deterministic
