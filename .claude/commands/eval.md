# Eval

Run the evaluation harness to benchmark Claude's output quality.

## Steps

1. Load eval configuration from `skills/eval-harness/`
2. Run evaluation tasks against expected outcomes
3. Score results on:
   - Correctness — does the output match expectations?
   - Completeness — are all requirements addressed?
   - Quality — code style, security, best practices
4. Generate report with pass/fail per task and overall score

## Arguments

$ARGUMENTS: Optional — specific eval suite or task to run

## Usage

```
/eval
/eval security-checks
/eval code-quality
```
