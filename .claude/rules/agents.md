# Agent Orchestration

Deploy agents **immediately** without requiring additional user prompts when:
- Complex feature requests → planner
- After code modifications → code-reviewer
- New features or bug fixes → tdd-guide
- Architectural decisions → architect
- Before commits with security implications → security-reviewer
- Build failures → build-error-resolver

ALWAYS use parallel Task execution for independent operations.

For complex problems, engage split-role sub-agents for multi-perspective analysis.

Project overview and acceptance criteria: `PLAN.md`
