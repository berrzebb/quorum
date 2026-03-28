# Commit Split Patterns

## When to Split

A 500-line change can be one commit. A 10-line change may need two.

| Situation | Order |
|-----------|-------|
| New feature | types/interfaces → core logic → integration → tests |
| Refactor then change behavior | structural change (refactor) → behavior change (fix/feat) |
| Dependency update | single commit regardless of file count |
| CI, docs, test changes | separate from code changes (except directly related tests) |

## How to Split

Use `git add -p` for interactive staging or `git reset HEAD <file>` to unstage selectively.

## Signs You Should NOT Split

- All files serve a single purpose (e.g., rename across codebase)
- Splitting would leave the codebase in a broken intermediate state
- The dependency update touches lock file + config only
