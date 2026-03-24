# blast_radius

Compute transitive impact of changed files via reverse import graph (BFS on inEdges).

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--changed` | string (comma-separated) | ✓ | Files that changed (relative paths) |
| `--path` | string | — | Repository root (default: cwd) |
| `--max-depth` | number | — | BFS depth limit (default: 10) |

## Example

```bash
node tool-runner.mjs blast_radius --changed "bus/store.ts,bus/lock.ts" --path src/
```

## Output

- Affected file count and ratio (affected / total)
- Per-file depth and dependency chain (via)
- Ratio > 0.1 signals high impact (used as 10th trigger factor in audit)
