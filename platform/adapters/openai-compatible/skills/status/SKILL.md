---
name: quorum-status
description: "Show current quorum gate status — audit verdicts, pending reviews, retro marker, active locks, agent assignments. All state from SQLite. Use to check what's happening before starting work, after a break, to verify audit completion, or when asking 'what's the current state'. Triggers on 'status', 'what's happening', 'show state', 'check gate'."
model: claude-sonnet-4-6
allowed-tools: read, bash(node *), bash(git *)
---

# Consensus Loop Status (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/status/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Run command | `bash` |

## Setup

Primary: `node ${ADAPTER_ROOT}/cli/index.ts status`

Fallback: `node ${ADAPTER_ROOT}/../../core/tools/tool-runner.mjs audit_history --summary --json`
