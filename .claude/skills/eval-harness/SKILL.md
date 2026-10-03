# Eval Harness

## Description

Evaluation framework to benchmark Claude's output quality against expected results.

## When to Use

- Via `/eval` command
- After modifying rules, agents, or commands
- To validate template effectiveness

## Evaluation Criteria

### Correctness
- Does the output match expected behavior?
- Are all requirements addressed?
- No regressions introduced?

### Quality
- Follows coding-style rules?
- Passes security checklist?
- Tests included and passing?

### Efficiency
- Minimal changes for the task?
- No unnecessary files created?
- Context used efficiently?

## Running Evals

1. Define expected outcomes for test tasks
2. Run Claude against each task
3. Compare outputs to expectations
4. Score: pass/fail per criterion
5. Generate report with overall score
