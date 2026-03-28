---
name: quorum-status
description: "Show current quorum gate status — audit verdicts, pending reviews, retro marker, active locks, agent assignments. All state from SQLite. Use to check what's happening before starting work, after a break, to verify audit completion, or when asking 'what's the current state'. Triggers on 'status', 'what's happening', '현재 상태'."
model: gemini-2.5-flash
allowed-tools: read_file, shell
---

# Consensus Loop Status (Gemini)

Follow the canonical protocol at `skills/status/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Run command | `shell` |

## Setup

Primary: `quorum status`

Fallback: `quorum tool audit_history --summary --json`
