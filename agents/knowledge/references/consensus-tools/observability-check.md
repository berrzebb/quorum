# observability_check

Detect observability gaps in application code. Uses `qualityRules.observability` from each language's `spec.observability.mjs`.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Directory or file to scan (default: cwd) |

## Example

```bash
quorum tool observability_check --path src/
```

## What It Checks

- Empty catch blocks (swallowed errors)
- Missing error logging in catch handlers
- `console.log` in production code (should use structured logger)
- Hard process exits without cleanup (`process.exit`, `os.Exit`)
- Missing metrics/tracing in critical paths
