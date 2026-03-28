---
name: quorum:retrospect
description: "Extract learnings from audit history, manage memories. Use after completing a track, during retrospective, or for memory maintenance. Triggers on 'what did we learn', 'retrospective', 'memory cleanup', '회고', '메모리 정리'."
argument-hint: "[track name or 'all']"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Grep, Glob, Bash(node *), Bash(git log*)
---

# Retrospect (Claude Code)

Follow the canonical protocol at `platform/skills/retrospect/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Setup

Config: `.quorum/config.json` — `plugin.locale`.
