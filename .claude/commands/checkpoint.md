# Checkpoint

Save a progress snapshot before risky changes.

## Steps

1. Run `git status` to see current state
2. Stage all meaningful changes
3. Create a commit with prefix `checkpoint:` and description of current state
4. Log the checkpoint for reference

## Arguments

$ARGUMENTS: Optional — description of what you're checkpointing

## Usage

```
/checkpoint Before refactoring auth module
/checkpoint Working state before migration
```
