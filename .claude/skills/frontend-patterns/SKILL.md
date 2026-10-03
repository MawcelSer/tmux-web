# Frontend Patterns

## Description

Frontend development patterns for component architecture, state management, rendering optimization, and accessibility.

## When to Use

- Building UI components
- Managing application state
- Optimizing render performance
- Ensuring accessibility

## Patterns

### Component Architecture
- Presentational vs. Container components
- Composition over props drilling
- Custom hooks for reusable logic

### State Management
- Local state for component-specific data
- Context for shared UI state (theme, locale)
- External store for server state (React Query, SWR)

### Performance
- Memoize expensive computations (useMemo)
- Prevent unnecessary re-renders (React.memo, useCallback)
- Virtualize long lists
- Lazy load routes and heavy components

### Accessibility
- Semantic HTML elements
- ARIA labels on interactive elements
- Keyboard navigation support
- Color contrast compliance (WCAG 2.1 AA)
