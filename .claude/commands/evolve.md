# Evolve

Cluster learned instincts into reusable skills.

## Steps

1. Read all learned instincts from `~/.claude/learned-skills/`
2. Cluster similar patterns by:
   - Domain (frontend, backend, testing, security)
   - Language/framework
   - Workflow type
3. For each cluster with sufficient patterns:
   - Generate a skill definition (`SKILL.md`)
   - Create configuration (`config.json`)
   - Save to `skills/` directory
4. Validate new skills: `node scripts/ci/validate-skills.cjs`
5. Report created skills

## Arguments

$ARGUMENTS: Optional — filter by domain or minimum pattern count

## Usage

```
/evolve
/evolve --domain frontend
/evolve --min-patterns 5
```
