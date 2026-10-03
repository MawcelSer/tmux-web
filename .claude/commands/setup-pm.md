# Setup Package Manager

Detect and configure the correct package manager for this project.

## Steps

1. Run the package manager detection script:
   ```bash
   node scripts/setup-package-manager.cjs
   ```
2. Detection checks (in order):
   - Lock files: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`
   - `packageManager` field in `package.json`
   - Environment variables
3. Save detected PM to `.claude/package-manager.json`
4. Confirm the configured package manager

## Arguments

$ARGUMENTS: Optional — force a specific package manager (npm, pnpm, yarn, bun)

## Usage

```
/setup-pm
/setup-pm pnpm
```
