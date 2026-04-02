# compat_check

Check for API breaking changes and compatibility issues. Uses `qualityRules.compat` from each language's `spec.compat.mjs`.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Directory or file to check (default: cwd) |

## Example

```bash
quorum tool compat_check --path src/
```

## What It Checks

- Deprecated API annotations and usage
- CJS/ESM module format mixing
- Pending removal markers
- Wildcard version dependencies
- Breaking signature changes
