---
name: quorum-guide
description: "Guide for writing evidence packages for the quorum audit. Use when preparing code review submissions or addressing audit rejections. Triggers on 'how to submit evidence', 'evidence format', 'write evidence'."
model: codex
allowed-tools: read_file, write_file, shell
---

# Quorum Evidence Guide (Codex)

Follow the canonical protocol at `skills/guide/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Run command | `shell` |

## Setup

Config: `.quorum/config.json` — `consensus.trigger_tag`, `agree_tag`, `pending_tag`.

Audit history: `quorum tool audit_history --summary`
