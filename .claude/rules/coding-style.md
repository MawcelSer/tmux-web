# Coding Style

## Immutability (Critical)

ALWAYS create new objects, NEVER mutate:

```typescript
// BAD - mutation
user.name = 'new';

// GOOD - immutable
const updatedUser = { ...user, name: 'new' };
```

## File Organization

- Prioritize many smaller files over few large files
- Files should be 200-400 lines, maximum 800 lines
- Organize by feature/domain, not by type

## Error Handling

- Use try-catch blocks with meaningful error messages
- Log errors with context: `console.error('Operation failed:', error)`
- Never swallow errors silently

## Input Validation

Validate all external input using schema libraries (e.g., Zod):

```typescript
const userSchema = z.object({
  email: z.string().email(),
  age: z.number().min(0).max(150)
});
```

## Code Quality Checklist

Before completing any task, verify:

- [ ] Readable, descriptive naming
- [ ] Functions under 50 lines
- [ ] Files under 800 lines
- [ ] Nesting limited to 4 levels max
- [ ] Proper error handling
- [ ] No console.log in production code
- [ ] No hardcoded values (use constants/env vars)
- [ ] Immutable patterns used throughout
