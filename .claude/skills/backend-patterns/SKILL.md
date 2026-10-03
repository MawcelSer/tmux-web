# Backend Patterns

## Description

Common backend development patterns for APIs, database interactions, service layers, caching, and error handling.

## When to Use

- Designing API endpoints
- Implementing service layer logic
- Setting up database interactions
- Configuring caching strategies

## Patterns

### API Response Format
```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: { total: number; page: number; limit: number }
}
```

### Repository Pattern
- Abstract data access behind interfaces
- One repository per domain entity
- Support filtering, pagination, sorting

### Service Layer
- Business logic lives in services, not controllers
- Services are stateless
- Use dependency injection

### Error Handling
- Use typed error classes
- Map internal errors to HTTP status codes
- Never expose internal details in API responses

### Caching
- Cache at the service layer, not the controller
- Use cache-aside pattern (check cache → miss → fetch → store)
- Set appropriate TTLs based on data volatility
