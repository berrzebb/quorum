# license_scan

Check dependency licenses for copyleft/unknown risks and scan source for hardcoded secrets or PII patterns.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Project root to scan (default: cwd) |

## Example

```bash
node tool-runner.mjs license_scan --path .
```

## What It Checks

- Copyleft licenses (GPL) in MIT/Apache projects
- Unknown/missing license declarations
- Hardcoded secrets and API keys in source
- PII patterns (emails, phone numbers)
