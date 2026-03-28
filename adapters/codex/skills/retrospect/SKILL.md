---
name: quorum-retrospect
description: "Extract learnings from audit history and conversation, manage memories. Use after completing a track, during retrospective, or for memory maintenance. Triggers on 'what did we learn', 'retrospective', 'memory cleanup', '회고'."
argument-hint: "[track name or 'all']"
model: codex
allowed-tools: read_file, write_file, shell, find_files, search
---

# Retrospect (Codex)

Follow the canonical protocol at `skills/retrospect/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |
| Spawn agent | `create_agent` |

## Setup

Config: `.quorum/config.json` — `plugin.locale`.
