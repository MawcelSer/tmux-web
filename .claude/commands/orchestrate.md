# Orchestrate

Coordinate multi-step processes across multiple agents.

## Steps

1. Analyze the requested workflow
2. Identify which agents are needed and in what order
3. Determine which steps can run in parallel vs. sequential
4. Execute the workflow:
   - Launch parallel agents for independent operations
   - Wait for dependencies before sequential steps
   - Aggregate results from all agents
5. Report combined results

## Arguments

$ARGUMENTS: Description of the multi-step workflow to orchestrate

## Usage

```
/orchestrate Review, test, and deploy the auth module changes
/orchestrate Plan the feature, implement with TDD, then review
```
