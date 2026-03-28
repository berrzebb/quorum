---
name: quorum-guide
description: "Guide for writing evidence packages for the quorum audit. Use when preparing code review submissions, structuring feedback evidence, or addressing audit rejections. Triggers on 'how to submit evidence', 'evidence format', 'write evidence', 'prepare for audit', 'how to submit audit'."
model: claude-sonnet-4-6
allowed-tools: read, grep, bash(node *), bash(git diff *), bash(git status *)
---

# Quorum Evidence Guide (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/guide/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Run command | `bash` |
| Search content | `grep` |

## Setup

Config: `${ADAPTER_ROOT}/core/config.json` — `consensus.trigger_tag`, `agree_tag`, `pending_tag`, `plugin.locale`.

Audit history: `node ${ADAPTER_ROOT}/core/tools/tool-runner.mjs audit_history --summary`
