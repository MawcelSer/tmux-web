# Coding Standards

## Description

Enforces language-agnostic coding standards across the project. Ensures consistent code quality through file organization, naming conventions, error handling, and immutability patterns.

## When to Use

- During code review
- When writing new code
- When refactoring existing code

## Standards

### File Organization
- 200-400 lines typical, 800 max
- Feature-based organization (not type-based)
- One concept per file

### Functions
- Under 50 lines
- Single responsibility
- Descriptive naming
- Max 4 levels of nesting

### Error Handling
- Try-catch with meaningful messages
- Never swallow errors silently
- Log with context

### Immutability
- Create new objects, never mutate
- Use spread/Object.assign for updates
- Prefer const over let
