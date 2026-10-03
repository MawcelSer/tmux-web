# TDD

Run a full test-driven development cycle for the specified feature or fix.

## Steps

1. Launch the **tdd-guide** agent
2. **RED**: Write a failing test that defines expected behavior
3. Run the test — confirm it FAILS
4. **GREEN**: Implement the minimum code to make the test pass
5. Run the test — confirm it PASSES
6. **REFACTOR**: Clean up the implementation while keeping tests green
7. Run all tests — confirm nothing is broken
8. Verify coverage is ≥ 80%

## Arguments

$ARGUMENTS: Description of the feature or bug to implement via TDD

## Usage

```
/tdd Add email validation to user registration
/tdd Fix race condition in session handler
```
