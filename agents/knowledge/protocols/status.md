# Status Protocol

Unified status reporting with subcommands.

## Usage

```
/quorum:status audit    # Gate state, verdicts, locks, retro (default)
/quorum:status skills   # Skill inventory, diagnostics
/quorum:status all      # Both
```

## Subcommand: audit

```
quorum status
```

Fallback: `quorum tool audit_history --summary --json`

### Interpretation

| State | Meaning | Next Action |
|-------|---------|-------------|
| **idle** | No pending audits | Start new work |
| **approved** | All items passed | Run retrospective, then merge |
| **pending** | Items awaiting or rejected | Fix rejections, re-submit |
| **locked** | Audit in progress | Wait |

## Subcommand: skills

```
quorum tool skill_sync --mode check
```

Checks: canonical→adapter parity, description sync, trigger conflicts, missing wrappers.

Verdicts are in **SQLite only** — do NOT look for verdict.md or gpt.md.
