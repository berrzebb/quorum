# Conventional Commit Types

## Standard Types

| Type | Use when |
|------|----------|
| `feat` | new feature |
| `fix` | bug fix |
| `refactor` | code restructure with no behavior change |
| `test` | adding or updating tests |
| `docs` | documentation only |
| `style` | formatting, whitespace (no logic change) |
| `chore` | build process, tooling, dependencies |
| `perf` | performance improvement |
| `ci` | CI/CD configuration |
| `build` | build system changes |
| `revert` | reverting a previous commit |
| `hotfix` | urgent production fix (bypasses normal flow) |

Projects often extend this list (e.g., `design`, `rename`). Check CLAUDE.md.

## Scope Conventions

Scope is optional but recommended for clarity:

```
feat(auth): add JWT refresh token support
fix(pagination): correct off-by-one in page offset
refactor(user): move UserService to services/
```

For monorepos, scope = package name. For single repos, scope = module or feature area.

## Breaking Changes

Mark with `!` after scope:

```
feat(api)!: change response format to JSON:API
```

Or add `BREAKING CHANGE:` footer in the body.

## Imperative Mood Test (Chris Beams)

The subject should complete this sentence:

> "If applied, this commit will **[subject]**"

- "If applied, this commit will **fix off-by-one error in pagination**" ✅
- "If applied, this commit will **fixed off-by-one error in pagination**" ❌
