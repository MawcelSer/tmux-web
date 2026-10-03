# Build Fix

Resolve build errors incrementally with minimal changes.

## Steps

1. Run the build command to capture error output
2. Launch the **build-error-resolver** agent
3. Analyze error messages — identify root causes
4. Fix ONE error at a time
5. Re-run build to verify the fix
6. Repeat until build passes
7. Run tests to ensure no regressions

## Arguments

$ARGUMENTS: Optional — specific build command (defaults to auto-detected build script)

## Usage

```
/build-fix
/build-fix npm run build
/build-fix npx tsc --noEmit
```
