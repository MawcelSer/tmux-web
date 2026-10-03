# Refactor Clean

Identify and clean up code smells, dead code, and technical debt.

## Steps

1. Scan the codebase (or specified scope) for:
   - Dead code (unused functions, variables, imports)
   - Code duplication
   - Functions exceeding 50 lines
   - Files exceeding 800 lines
   - Deep nesting (> 4 levels)
   - console.log statements
2. Prioritize findings by impact
3. Apply safe refactoring patterns:
   - Extract functions for long methods
   - Remove dead code
   - Simplify complex conditionals
4. Run tests after EACH refactoring — must stay green
5. Report what was cleaned and why

## Arguments

$ARGUMENTS: Optional — specific directory or file to refactor

## Usage

```
/refactor-clean
/refactor-clean src/services/
```
