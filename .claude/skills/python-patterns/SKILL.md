# Python Patterns

## Description

Idiomatic Python patterns for clean, maintainable, and performant Python code.

## When to Use

- Writing new Python code
- Reviewing Python code
- Refactoring Python projects

## Patterns

### Type Hints
- Use type hints on all function signatures
- Use `Optional[T]` for nullable types
- Use `TypeVar` for generics
- Run mypy/pyright for type checking

### Idiomatic Python
- List comprehensions over map/filter for simple transforms
- Context managers (`with`) for resource management
- f-strings for string formatting
- Dataclasses or Pydantic for structured data
- `pathlib.Path` over `os.path`

### Error Handling
- Specific exception types (not bare `except:`)
- Custom exceptions for domain errors
- Use `raise from` for exception chaining

### Project Structure
```
src/
├── __init__.py
├── main.py
├── models/
├── services/
├── api/
└── utils/
tests/
├── conftest.py
├── test_models/
├── test_services/
└── test_api/
```

### Testing
- pytest over unittest
- Fixtures for test setup
- parametrize for test variants
- conftest.py for shared fixtures
