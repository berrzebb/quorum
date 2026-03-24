# doc_coverage

Measure documentation coverage: percentage of exported symbols with doc comments. Uses `docPatterns` from each language's `spec.doc.mjs`.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Directory or file to scan (default: cwd) |

## Example

```bash
node tool-runner.mjs doc_coverage --path src/
```

## Output

- Coverage percentage (documented exports / total exports)
- List of undocumented exports with file:line locations
- Per-file breakdown
