# Continuous Learning v2

## Description

Instinct-based learning system that extracts patterns from Claude Code sessions, scores them by confidence, and applies learned behaviors to future sessions.

## When to Use

- Automatically triggered at session end via `evaluate-session.js` hook
- Manually via `/instinct-status`, `/instinct-import`, `/instinct-export`
- Via `/evolve` to cluster instincts into skills

## How It Works

1. **Extract**: At session end, analyze the transcript for recurring patterns
2. **Score**: Assign confidence scores based on frequency and success
3. **Store**: Save learned patterns to `~/.claude/learned-skills/`
4. **Apply**: On future sessions, load and apply high-confidence patterns
5. **Evolve**: Periodically cluster related instincts into formal skills

## Configuration

See `config.json` for:
- `min_session_length` — Minimum messages before evaluating (default: 10)
- `learned_skills_path` — Where to store learned patterns
- `confidence_threshold` — Minimum confidence to auto-apply (default: 0.7)
