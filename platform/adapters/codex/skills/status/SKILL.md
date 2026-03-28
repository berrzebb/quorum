---
name: quorum-status
description: "Show current quorum gate status — audit verdicts, pending reviews, retro marker, active locks. All state from SQLite. Triggers on 'status', 'what's happening', 'show state'."
model: codex
allowed-tools: read_file, shell
---

# Consensus Loop Status (Codex)

Follow the canonical protocol at `platform/skills/status/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Run command | `shell` |

## Setup

Primary: `quorum status`

Fallback: `quorum tool audit_history --summary --json`
