# quorum — Plugin Reference

> Status: `active` | Package: `berrzebb/quorum`

Cross-model audit gate with structural enforcement. One model cannot approve its own code.

Edit → audit → agree → retro → commit.

---

## Why

1. **Independent critique** — the writing AI and the reviewing AI are separate. A single model cannot catch its own blind spots.
2. **No consensus, no progress** — items tagged `[trigger_tag]` remain incomplete until promoted to `[agree_tag]`.
3. **Automatic retrospective** — after consensus, the session gate blocks commits until retrospective completes.
4. **Policy as data** — audit criteria live in `references/` files. Adjust team policy without code changes.

---

## Audit Flow

```
code edit → PostToolUse hook
    │
    ├─ trigger evaluation (6-factor scoring)
    │   ├─ T1 skip (micro change, no audit)
    │   ├─ T2 simple (single auditor)
    │   └─ T3 deliberative (Advocate + Devil's Advocate → Judge)
    │
    ├─ stagnation check → escalation if stuck
    │
    ├─ audit spawn (background)
    │       ↓
    │   verdict → tag sync
    │       ↓
    │   ┌── [agree_tag] → retro gate → commit
    │   └── [pending_tag] → correction → resubmit
    │
    └─ quality rules (eslint, tsc)
```

---

## CLI

```bash
quorum setup              # initialize project
quorum daemon             # TUI dashboard
quorum status             # gate status
quorum audit              # manual trigger
quorum plan               # list work breakdowns
quorum ask codex "..."    # direct provider query
quorum tool code_map      # run MCP tool
```

---

## Deliberative Consensus (T3)

| Round | Roles | Purpose |
|-------|-------|---------|
| 1 (parallel) | Advocate + Devil's Advocate | Independent analysis |
| 2 (sequential) | Judge | Final verdict from both opinions |

Devil's Advocate checks: **root cause vs symptom treatment.**

---

## Providers

| Provider | Mechanism | Status |
|----------|-----------|--------|
| Claude Code | 12 native hooks | Active |
| Codex | File watch + state polling | Active |

---

## Configuration

`.claude/quorum/config.json`:

```jsonc
{
  "consensus": {
    "watch_file": "docs/feedback/claude.md",
    "trigger_tag": "[REVIEW_NEEDED]",
    "agree_tag": "[APPROVED]",
    "pending_tag": "[CHANGES_REQUESTED]"
  }
}
```
