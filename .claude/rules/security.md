# Security

## Pre-Commit Security Checklist

Before EVERY commit, verify:

1. [ ] All user inputs validated and sanitized
2. [ ] SQL queries use parameterized statements (never string concatenation)
3. [ ] HTML output sanitized to prevent XSS
4. [ ] CSRF protection enabled on state-changing endpoints
5. [ ] Authentication and authorization verified on all protected routes
6. [ ] Rate limiting implemented on public endpoints
7. [ ] Error messages don't expose internal details (stack traces, DB schemas, file paths)
8. [ ] No secrets, API keys, or credentials in code

## Secret Management

NEVER hardcode secrets. ALWAYS use environment variables:

```typescript
// BAD
const apiKey = 'sk-1234567890';

// GOOD
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY environment variable is required');
}
```

## Incident Response

If a security vulnerability is discovered:

1. **STOP** all other work immediately
2. **ESCALATE** to security-reviewer agent
3. **FIX** critical issues before proceeding with any other work
4. **ROTATE** any exposed secrets or credentials
5. **REVIEW** entire codebase for similar vulnerabilities
