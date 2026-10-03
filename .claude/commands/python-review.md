# Python Review

Run a Python-specific code review.

## Steps

1. Identify all modified Python files
2. Review for:
   - PEP 8 compliance
   - Type hint usage and correctness
   - Idiomatic Python patterns (list comprehensions, context managers, etc.)
   - Common pitfalls (mutable default args, late binding closures)
   - Exception handling best practices
   - Import organization
3. Check test coverage for modified code
4. Categorize findings: CRITICAL > HIGH > MEDIUM > LOW
5. Present findings with file:line references

## Arguments

$ARGUMENTS: Optional — specific files or directory to review

## Usage

```
/python-review
/python-review src/services/
```
