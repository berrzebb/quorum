# a11y_scan

Scan JSX/TSX for accessibility issues. Uses `qualityRules.a11y` from `spec.a11y.mjs` (TypeScript only).

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Directory or file to scan (default: cwd) |

## Example

```bash
quorum tool a11y_scan --path src/components/
```

## What It Checks

- Missing `alt` on images
- `onClick` without keyboard handler (`onKeyDown`/`onKeyUp`)
- Form inputs without labels
- Missing ARIA attributes
- Interactive elements without focus management
