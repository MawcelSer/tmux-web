# Performance

## Model Selection

| Model | Use Case |
|-------|----------|
| **Sonnet 5.5** | Main development work |
| **Opus 5.5** | Deepest reasoning, complex architectural decisions, orchestrating multi-agent workflows |

## Context Window Management

- Avoid the final 30% of context window during resource-intensive tasks (refactoring, multi-file debugging)
- Single-file edits have lower context sensitivity
- Use `/compact` at logical breakpoints to free context space

## Deep Reasoning

For challenging problems:
- Use `/effort max` for deepest reasoning
- Incorporate multiple critique rounds for thorough analysis

## Build Error Resolution

When builds fail:
1. Delegate to build-error-resolver agent
2. Analyze error messages systematically
3. Fix incrementally — one error at a time
4. Verify between each fix
- Never make sweeping changes to fix a single error
