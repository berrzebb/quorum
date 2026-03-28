---
name: quorum:audit
description: "Run a quorum audit manually — trigger consensus review, re-run failed audits, test audit prompts, or force a specific provider. Use when the hook-based auto-trigger didn't fire, or you want explicit control. Triggers on 'run audit', 'audit again', 'review my code', 'check evidence'."
argument-hint: "[--dry-run | --no-resume | --auto-fix | --model <name>]"
model: claude-sonnet-4-6
allowed-tools: Read, Bash(node *), Bash(git *)
---

# Manual Audit (Claude Code)

Follow the canonical protocol at `skills/audit/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Run command | `Bash` |

## Setup

Audit runner: `node ${CLAUDE_PLUGIN_ROOT}/core/audit.mjs {{ arguments }}`

Config: `${CLAUDE_PLUGIN_ROOT}/core/config.json` — `consensus.trigger_tag`, `agree_tag`, `pending_tag`, `consensus.roles`.

Audit history: `node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_history --summary`
