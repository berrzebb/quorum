---
name: quorum-audit
description: "Run a quorum audit manually — trigger consensus review, re-run failed audits, test audit prompts, or force a specific provider. Use when the hook-based auto-trigger didn't fire, or you want explicit control. Triggers on 'run audit', 'audit again', 'review my code', 'check evidence'."
argument-hint: "[--dry-run | --no-resume | --auto-fix | --model <name>]"
model: claude-sonnet-4-6
allowed-tools: read, bash(node *), bash(git *)
---

# Manual Audit (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/audit/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Run command | `bash` |

## Setup

Audit runner: `node ${ADAPTER_ROOT}/core/audit.mjs {{ arguments }}`

Config: `${ADAPTER_ROOT}/core/config.json` — `consensus.trigger_tag`, `agree_tag`, `pending_tag`, `consensus.roles`.

Audit history: `node ${ADAPTER_ROOT}/core/tools/tool-runner.mjs audit_history --summary`
