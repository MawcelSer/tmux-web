# Skill Create

Generate a new skill module from patterns in your codebase or git history.

## Steps

1. Analyze the specified area of the codebase or git history
2. Extract recurring patterns, conventions, and workflows
3. Generate a skill definition with:
   - `SKILL.md` — documentation and instructions
   - `config.json` — skill metadata and configuration (if needed)
4. Save to `skills/[skill-name]/`
5. Run validation: `node scripts/ci/validate-skills.cjs`

## Arguments

$ARGUMENTS: Description of the skill to create, or area of code to extract patterns from

## Usage

```
/skill-create Extract API error handling patterns from src/services/
/skill-create Create a skill for our React component conventions
```
