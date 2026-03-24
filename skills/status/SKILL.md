---
name: quorum:status
description: "Show current quorum gate status — audit verdicts, pending reviews, retro marker, active locks, agent assignments. All state from SQLite. Use to check what's happening before starting work, after a break, or to see audit results. Triggers on 'status', 'what's happening', 'show state', 'check gate', '현재 상태', '상태 확인'. Do NOT use for code verification — use quorum:verify instead."
model: claude-sonnet-4-6
allowed-tools: Read, Bash(node *), Bash(git *)
---

# Consensus Loop Status

Check the current state of the quorum feedback cycle. All state lives in **SQLite** — this skill queries it and presents a summary.

## Primary Command

```bash
node ${CLAUDE_PLUGIN_ROOT}/cli/index.ts status
```

This outputs gate state, pending items, recent verdicts, and active locks from SQLite.

## Detailed Checks

If the CLI is unavailable, gather status from individual sources:

### 1. Config

```bash
node -e "const c=JSON.parse(require('fs').readFileSync('${CLAUDE_PLUGIN_ROOT}/core/config.json','utf8'));console.log(JSON.stringify({watch_file:c.consensus.watch_file,trigger:c.consensus.trigger_tag,agree:c.consensus.agree_tag,pending:c.consensus.pending_tag},null,2))"
```

### 2. Gate State (SQLite)

```bash
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_history --summary --json
```

Shows: last verdict, verdict counts, rejection patterns, timestamps.

### 3. Active Locks

```bash
node -e "const s=require('${CLAUDE_PLUGIN_ROOT}/dist/bus/store.js');const db=new s.EventStore('.claude/quorum-events.db');console.log(JSON.stringify(db.queryLocks(),null,2))"
```

### 4. Retro Marker

```bash
cat "$(git rev-parse --show-toplevel)/.claude/retro-marker.json" 2>/dev/null || echo '{"retro_pending": false}'
```

### 5. Session Handoff (if exists)

```bash
head -30 "$(git rev-parse --show-toplevel)/.claude/session-handoff.md" 2>/dev/null || echo "No active handoff"
```

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
| Active Agents | N (from handoff) |

### Recent Verdicts
| Item | Verdict | Time | Rejection Codes |
|------|---------|------|----------------|
| ... | ... | ... | ... |
```

## Interpretation Guide

| State | Meaning | Next Action |
|-------|---------|-------------|
| **idle** | No pending audits, clean state | Start new work |
| **approved** | All items passed audit | Run retrospective → merge |
| **pending** | Items awaiting audit or rejected | Fix rejections → re-submit |
| **locked** | Audit in progress | Wait for completion |

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Show formatted status → suggest next actions |
| **Headless** | Output JSON status → exit |
