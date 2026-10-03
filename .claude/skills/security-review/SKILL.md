# Security Review

## Description

Structured security vulnerability scanning workflow following OWASP guidelines and project security rules.

## When to Use

- Before every commit (auto-triggered via security-reviewer agent)
- During code review
- After adding new endpoints or user-facing features
- When handling authentication/authorization changes

## Checklist

### Input Validation
- [ ] All user inputs validated with schema library (Zod, Joi, etc.)
- [ ] File uploads validated (type, size, content)
- [ ] URL parameters sanitized

### Injection Prevention
- [ ] SQL: Parameterized queries only
- [ ] XSS: HTML output escaped/sanitized
- [ ] Command: No shell injection vectors
- [ ] LDAP/NoSQL: Queries sanitized

### Authentication & Authorization
- [ ] Auth required on all protected routes
- [ ] Authorization checked (not just authentication)
- [ ] Tokens have appropriate expiry
- [ ] Password hashing uses bcrypt/argon2

### Data Protection
- [ ] Secrets in environment variables only
- [ ] Error messages don't expose internals
- [ ] Logs don't contain sensitive data
- [ ] HTTPS enforced

### Rate Limiting
- [ ] Public endpoints rate-limited
- [ ] Login attempts throttled
- [ ] API keys have usage limits
- [ ] WebSocket events rate-limited per-socket (especially auth events)

### Environment Guard Inversion
- [ ] Security-sensitive toggles use allowlist pattern, NOT production check

```typescript
// BAD — unknown envs (staging, undefined) get permissive settings
const isProduction = process.env.NODE_ENV === 'production';
max: isProduction ? 10 : 200

// GOOD — only known dev/test envs get relaxed settings
const isRelaxedEnv = ['development', 'test'].includes(process.env.NODE_ENV ?? '');
max: isRelaxedEnv ? 200 : 10
```

Apply to: rate limits, secure cookie flags, CORS origins, debug logging.
