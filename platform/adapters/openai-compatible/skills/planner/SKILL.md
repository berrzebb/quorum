---
name: quorum-planner
description: "Design tasks into tracks with work breakdowns. Writes and maintains PRDs, generates DRM-driven documents. Triggers on 'add feature X', 'plan Z', 'write PRD', 'design tasks', '기능 추가', '설계'."
argument-hint: "<requirement or feature description>"
context: fork
model: claude-opus-4-6
allowed-tools: read, write, grep, glob, bash(node *), bash(cat *), bash(ls *)
---

# Planner (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/planner/SKILL.md`.
Reference documents are in `platform/skills/planner/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Setup

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.locale`.
