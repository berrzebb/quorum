---
name: quorum-retrospect
description: "Extract learnings from audit history, manage memories. Use after completing a track, during retrospective, or for memory maintenance. Triggers on 'what did we learn', 'retrospective', 'memory cleanup', '회고'."
argument-hint: "[track name or 'all']"
model: gemini-2.5-flash
allowed-tools: read_file, write_file, shell, glob, grep
---

# Retrospect (Gemini)

Follow the canonical protocol at `skills/retrospect/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |

## Setup

Config: `.quorum/config.json` — `plugin.locale`.
