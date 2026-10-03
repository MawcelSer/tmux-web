# Testing

## Coverage Requirements

Minimum **80% test coverage** across all categories:

- **Unit Tests**: Isolated functions and components
- **Integration Tests**: APIs, database interactions, service boundaries
- **E2E Tests**: Critical user workflows (Playwright, Cypress, etc.)

## Test-Driven Development (TDD)

Follow the RED-GREEN-REFACTOR cycle:

1. **RED**: Write the test first — it MUST fail
2. **GREEN**: Implement the minimum code to make the test pass
3. **REFACTOR**: Clean up the code while keeping tests green
4. **VERIFY**: Confirm 80%+ coverage is maintained

## Available Agents

- **tdd-guide**: Proactively enforces test-first methodology for new features
- **e2e-runner**: Focused on E2E automation testing

## When Tests Fail

1. Consult the tdd-guide agent
2. Examine test isolation (are tests independent?)
3. Validate mock configurations
4. **Fix the implementation, NOT the tests** (unless the test itself is wrong)

## Principles

- Tests should be deterministic — same input, same result
- Each test should test ONE thing
- Use descriptive test names that explain the expected behavior
- Keep tests close to the code they test
