# Iterative Retrieval

## Description

Multi-round codebase search skill. When a single search isn't enough, performs iterative retrieval across multiple passes, refining results until the needed information is found.

## When to Use

- Searching for code patterns across large codebases
- Finding all usages of a function/type/pattern
- Understanding data flow across multiple files
- Answering questions that require cross-referencing

## Process

1. **Initial Search** — Broad search with primary keywords
2. **Analyze Results** — Identify relevant files and missing context
3. **Refine** — Narrow search based on findings, follow imports/exports
4. **Cross-Reference** — Connect findings across files
5. **Synthesize** — Combine results into a complete answer

## Principles

- Start broad, narrow progressively
- Follow the dependency chain (imports → usages → tests)
- Stop when no new relevant information is found
- Max 5 retrieval rounds to prevent infinite loops
