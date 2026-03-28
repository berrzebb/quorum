# perf_scan

Scan for performance anti-patterns using **hybrid scanning**: regex first pass (speed) → AST second pass (precision, TypeScript only).

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--path` | string | — | Directory or file to scan (default: cwd) |

## Example

```bash
quorum tool perf_scan --path src/
```

## What It Checks

Uses `qualityRules.perf` from each language's `spec.perf.mjs` fragment:
- Nested loops (O(n²))
- Synchronous I/O (readFileSync, execSync)
- Unbounded queries (findAll without limit)
- Heavy imports (full lodash)
- SELECT * queries
- Dynamic regex in hot paths

See `references/languages.md` for full pattern format and language coverage.

## Hybrid Mode

For TypeScript files, `perf_scan` uses the AST analyzer (`ast-bridge.mjs`) as a second pass to refine regex matches — reducing false positives for patterns that require structural understanding.
