# Git Workflow

## Commit Message Format

Follow conventional commits: `<type>: <description>`

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`, `revert`, `style`

Examples:
- `feat: add user authentication flow`
- `fix: resolve race condition in session handler`
- `refactor: extract validation logic to shared module`
- `test: add integration tests for payment API`

## Pull Request Process

1. Analyze the **full commit history** — not just the latest commit
2. Use `git diff [base-branch]...HEAD` to review all modifications
3. Create detailed PR summaries with:
   - What changed and why
   - Test plan with action items
4. Push new branches with the `-u` flag

## Feature Development Flow

1. **Plan**: Use planner agent to map dependencies and identify risks
2. **Test**: Write tests first (RED phase)
3. **Implement**: Minimum code to pass tests (GREEN phase)
4. **Refactor**: Clean up while staying green (REFACTOR phase)
5. **Review**: Use code-reviewer agent, prioritize CRITICAL/HIGH findings
6. **Commit**: Detailed message following conventional format
7. **Push**: Review diff before pushing
