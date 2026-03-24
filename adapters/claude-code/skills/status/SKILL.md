---
name: quorum:status
description: "Show current quorum gate status — audit verdicts, pending reviews, retro marker, active locks, agent assignments. All state from SQLite. Use to check what's happening before starting work, after a break, to verify audit completion, or when asking 'what's the current state'. Triggers on 'status', 'what's happening', 'show state', 'check gate'."
model: claude-sonnet-4-6
allowed-tools: Read, Bash(node *), Bash(git *)
---

# Consensus Loop Status (Claude Code)

Check the current state of the quorum feedback cycle. All state lives in **SQLite** — this skill queries it and presents a summary.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Run command | `Bash` |

## Primary Command

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/index.ts status
```

This outputs gate state, pending items, recent verdicts, and active locks from SQLite.

## Fallback

If quorum CLI is unavailable, query the audit history tool directly:

```bash
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_history --summary --json
```

Shows: last verdict, verdict counts, rejection patterns, timestamps.

## Output Format

Present a structured summary:

```markdown
## Quorum Status

| Item | Value |
|------|-------|
| Gate State | approved / pending / idle |
| Pending Items | N items with [trigger_tag] |
| Last Verdict | [agree_tag] / [pending_tag] — timestamp |
| Active Locks | N (list lock holders) |
| Retro Status | pending / complete |
```

Do NOT look for verdict.md or gpt.md — verdicts live in SQLite only. Use `quorum status` or `audit_history` tool for all verdict queries.

## Interpretation Guide

| State | Meaning | Next Action |
|-------|---------|-------------|
| **idle** | No pending audits, clean state | Start new work |
| **approved** | All items passed audit | Run retrospective, then merge |
| **pending** | Items awaiting audit or rejected | Fix rejections, re-submit evidence |
| **locked** | Audit in progress | Wait for completion |

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Show formatted status, suggest next actions based on state |
| **Headless** | Output JSON status, exit |
