# Client-Side API Hardening

## Description

Security patterns for frontend code consuming REST APIs. Covers input validation on the client side, CSS injection prevention, URL interpolation safety, and IndexedDB cache integrity. Evolved from Sprint 3b code review findings.

## When to Use

- Building API client functions that interpolate user/server data into URLs
- Rendering API-supplied values in CSS (colors, sizes, URLs)
- Caching API responses in IndexedDB or localStorage
- Handling API error responses for user-facing error states

## Patterns

### 1. URL Parameter Validation

Never interpolate unsanitized values into API URLs. Share validation regex with the server via `@golfix/shared`.

```typescript
// shared/schemas/course.ts
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

// client/api/courses.ts
import { SLUG_RE } from '@golfix/shared';

function assertValidSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new Error('Invalid course slug');
}

export async function getCourseInfo(slug: string) {
  assertValidSlug(slug);
  return apiFetch(`/api/v1/courses/${slug}/info`);
}
```

### 2. CSS Value Sanitization

API-supplied strings used in `style={}` must be validated against a safe allowlist. Never pass raw API values as CSS properties.

```typescript
const SAFE_COLORS = new Set(['black', 'white', 'yellow', 'blue', 'red', 'green', 'orange']);

const safeColor = SAFE_COLORS.has(apiColor.toLowerCase())
  ? apiColor.toLowerCase()
  : '#9ca3af'; // fallback neutral
```

### 3. Falsy vs Null Checks

GeoJSON properties from MapLibre features return `0` for valid coordinates. Use explicit null checks, not truthy checks.

```typescript
// BAD — rejects lat=0 or lng=0
if (carryLat && carryLng) { ... }

// GOOD
if (carryLat !== null && carryLng !== null) { ... }
```

### 4. Error Classification

Don't match API errors by message string. Use HTTP status codes or structured error types.

```typescript
// BAD — brittle, breaks if API changes wording
if ((err as any).error === 'No course found at this location') { ... }

// GOOD — check error shape safely
const errorObj = err as Record<string, unknown> | null;
if (typeof errorObj === 'object' && errorObj !== null &&
    typeof errorObj.error === 'string' &&
    errorObj.error.includes('No course found')) {
  setLocateError('not-found');
}

// BEST — propagate HTTP status through apiFetch
```

### 5. IDB Cache Integrity

- Always log cache errors in dev mode (never silently swallow)
- Close IDB connections in `finally` blocks
- Validate cached data schema on read if possible

```typescript
} catch (err) {
  if (import.meta.env.DEV) console.warn('[idb-cache] getCached failed:', err);
  return null;
}
```

### 6. API Key Handling

`VITE_` prefixed keys are inlined into the JS bundle — they are NOT secrets. Always:
- Restrict API keys by domain/referrer in the provider dashboard
- Warn loudly in dev when keys are missing
- Use `??` fallback, never fail silently

```typescript
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY;
if (!MAPTILER_KEY && import.meta.env.DEV) {
  console.warn('[Map] VITE_MAPTILER_KEY not set — tiles will fail');
}
```

### 7. Prevent Info Oracles (Server-Side)

Return identical error codes for "not found" and "not authorized" to prevent probing.

```typescript
// BAD — reveals session existence to non-owners
if (!session) return reply.status(404).send({ error: 'Not found' });
if (session.userId !== user.sub) return reply.status(403).send({ error: 'Forbidden' });

// GOOD — indistinguishable
if (!session || session.userId !== user.sub) {
  return reply.status(404).send({ error: 'Not found' });
}
```

## Evolved From

- Sprint 3b code review: 4 HIGH, 5 MEDIUM security findings
- MEMORY.md: CORS, rate limit, JWT gotchas
