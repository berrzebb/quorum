---
name: quorum-guide
description: "Guide for writing evidence packages for the quorum audit. Use when preparing code review submissions, structuring feedback evidence, or addressing audit rejections. Triggers on 'how to submit evidence', 'evidence format', 'write evidence', 'prepare for audit', 'how to submit audit'."
model: gemini-2.5-flash
allowed-tools: read_file, write_file, shell
---

# Quorum Evidence Guide (Gemini)

Follow the canonical protocol at `platform/skills/guide/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Run command | `shell` |

## Setup

Config: `.quorum/config.json` — `consensus.trigger_tag`, `agree_tag`, `pending_tag`.

Audit history: `quorum tool audit_history --summary`
