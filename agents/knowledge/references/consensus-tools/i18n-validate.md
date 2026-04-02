# i18n_validate

Validate i18n locale key parity and detect hardcoded UI strings. Uses `i18nHardcodedRe` from each language spec.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Project root to scan (default: cwd) |

## Example

```bash
quorum tool i18n_validate --path src/
```

## What It Checks

- Missing locale keys across language files (EN has key, KO doesn't)
- Hardcoded UI strings in JSX components (detected via `i18nHardcodedRe`)
- Unused locale keys
