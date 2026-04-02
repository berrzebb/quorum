# act_analyze

PDCA Act phase — analyze audit history + FVM results to produce structured improvement items.

## Parameters

| Param | Type | Required | Description |
|-------|------|:--------:|-------------|
| `--audit-history-path` | string | — | Path to audit-history.jsonl (default: .claude/audit-history.jsonl) |
| `--fvm-results-path` | string | — | Path to FVM validation results markdown |
| `--track` | string | — | Filter audit history by track name |
| `--thresholds` | JSON | — | Override default thresholds (fp_rate_warn, repeat_rejection_warn, etc.) |

## Example

```bash
quorum tool act_analyze --track OR
quorum tool act_analyze --fvm-results-path docs/plan/OR/fvm-results.md
```

## Output

- Metrics: rejection rates, false-positive rates, FVM pass rates, correction round counts
- Work-catalog-ready improvement items with priority, type, and target file
- Use during retrospective to close the Plan-Do-Check-Act loop
