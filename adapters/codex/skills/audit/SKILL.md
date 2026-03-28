---
name: quorum-audit
description: "Run a quorum audit manually — trigger consensus review, re-run failed audits, or force a specific provider. Use when hook-based auto-trigger didn't fire. Triggers on 'run audit', 'audit again', 'review my code'."
argument-hint: "[--dry-run | --no-resume | --auto-fix | --model <name>]"
model: codex
allowed-tools: read_file, shell, find_files
---

# Manual Audit (Codex)

Follow the canonical protocol at `skills/audit/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |

## Setup

Audit runner: `quorum audit` (fallback: `node core/audit.mjs`)

Config: `core/config.json` — `consensus.trigger_tag`, `agree_tag`, `pending_tag`, `consensus.roles`.

Audit history: `quorum tool audit_history --summary`
