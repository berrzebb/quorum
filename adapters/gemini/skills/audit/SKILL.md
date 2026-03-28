---
name: quorum-audit
description: "Run a quorum audit manually — trigger consensus review, re-run failed audits, test audit prompts, or force a specific provider. Use when hook-based auto-trigger didn't fire, or you want explicit control over the audit process. Triggers on 'run audit', 'audit again', 'review my code', 'check evidence'."
argument-hint: "[--dry-run | --no-resume | --auto-fix | --model <name>]"
model: gemini-2.5-pro
allowed-tools: read_file, shell, glob
---

# Manual Audit (Gemini)

Follow the canonical protocol at `skills/audit/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Run command | `shell` |

## Setup

Audit runner: `quorum audit` (fallback: `node core/audit.mjs`)

Config: `core/config.json` — `consensus.trigger_tag`, `agree_tag`, `pending_tag`, `consensus.roles`.

Audit history: `quorum tool audit_history --summary`
