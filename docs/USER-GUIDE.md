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

## Quick Start

```bash
# Install as Claude Code plugin
claude plugin add berrzebb/quorum

# Initialize in your project
quorum setup

# Start the TUI dashboard
quorum daemon
```

---

## CLI

```bash
quorum setup                             # initialize project
quorum daemon                            # TUI dashboard
quorum status                            # gate status
quorum parliament "topic"                # parliamentary deliberation → CPS
quorum orchestrate plan <track>          # interactive planner
quorum orchestrate run <track>           # wave-based execution
quorum orchestrate run <track> --resume  # resume from checkpoint
quorum plan                              # list work breakdowns
quorum ask codex "..."                   # direct provider query
quorum tool <name> [path] [options]      # run MCP tool (see TOOLS.md)
quorum verify                            # run all quality checks
quorum verify CQ|T|TEST|SCOPE|SEC|LEAK|DEP  # run specific check
```

---

## Parliament

Legislative deliberation for strategic decisions.

```bash
quorum parliament "payment system design"       # basic deliberation
quorum parliament --rounds 3 "auth design"      # multi-round convergence
quorum parliament --mux "system design"         # daemon-observable sessions
quorum parliament --history                     # review past sessions
quorum parliament --resume <id>                 # continue deliberation
```

5 enforcement gates block work when protocol conditions are violated:

| Gate | Blocks When | Bypass |
|------|------------|--------|
| Amendment | Pending amendments unresolved | `--force` |
| Verdict | Latest audit ≠ approved | `--force` |
| Confluence | Verification failed | `--force` |
| Design | Design artifacts missing | `--force` |
| Regression | Normal-form stage regressed | alert only |

---

## Wave Execution

```bash
quorum orchestrate plan <track> --provider claude   # plan interactively
quorum orchestrate run <track> --provider claude     # execute waves
quorum orchestrate run <track> --resume              # resume from checkpoint
```

- Phase parents define gate boundaries (Phase N completes before Phase N+1)
- Items in the same wave run in parallel (`--concurrency N`, default 3)
- On audit failure, **Fixer** agent applies targeted fixes → re-audit
- `--resume` survives process crashes and restarts

### Parallel Planner (v0.6.5)

`quorum setup --agenda "<topic>" -y` runs the planner as 3 parallel sub-agents:

| Phase | Agent | Output |
|-------|-------|--------|
| 1 | planner-prd | PRD.md, spec.md, blueprint.md, domain-model.md |
| 2a | planner-wb | work-breakdown.md (dedicated agent) |
| 2b | planner-support | execution-order.md, test-strategy.md, work-catalog.md |

Phase 2 starts after Phase 1 completes (design docs must exist before WB).

CLI args are properly separated:
- `-p <task prompt>` — user prompt
- `--append-system-prompt <system>` — system-level instructions
- `--output-format stream-json` — ndjson for daemon capture (mux path only)

---

## TUI Dashboard

`quorum daemon` — 4 views with fixed-height layout, tab navigation:

| Key | View | Contents |
|-----|------|----------|
| 1 | Overview | GateStatus, AuditStream (scrollable), ParliamentPanel, TrackProgress |
| 2 | Review | FindingStats, OpenFindings, FileThreads |
| 3 | Chat | SessionList (↑↓ navigate), TranscriptPane (ndjson→rich markdown), Composer, GitExplorer |
| 4 | Operations | AgentPanel, FitnessPanel, LockPanel, SpecialistPanel, AgentQueryPanel |

Chat view features:
- **Agent sessions** from mux (psmux/tmux) + `.claude/agents/*.json` auto-discovery
- **ndjson parsing** with wrapped-line rejoin (psmux terminal width compensation)
- **Rich rendering**: markdown, tool icons, thinking blocks, collapsed groups
- **Bidirectional**: scroll transcript, send input to agent via Composer
- **Git explorer**: commit log (↑↓), changed files, commit detail

---

## Configuration

`.claude/quorum/config.json`:

```jsonc
{
  "consensus": {
    "trigger_tag": "[REVIEW_NEEDED]",
    "agree_tag": "[APPROVED]",
    "pending_tag": "[CHANGES_REQUESTED]"
  },
  "hooks": {},
  "parliament": {
    "enabled": true,
    "convergenceThreshold": 2,
    "eligibleVoters": 3,
    "maxRounds": 10,
    "maxAutoAmendments": 5,
    "roles": { "advocate": "claude", "devil": "claude", "judge": "claude" }
  }
}
```

### Custom Hooks

```jsonc
{
  "hooks": {
    "audit.submit": [
      { "name": "freeze-guard", "handler": { "type": "command", "command": "node scripts/check.mjs" } }
    ]
  }
}
```

---

## Adapters

| Adapter | Hooks | Status |
|---------|-------|--------|
| Claude Code | 21 events | Active |
| Gemini CLI | 11 events | Active |
| Codex CLI | 6 events | Active |
| OpenAI-compatible | shared | Active |

---

## Migration from consensus-loop

```bash
quorum migrate            # import config, history, session state
quorum migrate --dry-run  # preview without changes
```

---

## More

- [Tools Reference](TOOLS.md) — 22 deterministic MCP tools
- [AI Agent Guide](AI-GUIDE.md) — for AI agents working in quorum projects
- [System Architecture](../../system/README.md) — internal design, philosophy, component catalogs
