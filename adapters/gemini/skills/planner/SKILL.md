---
name: quorum-planner
description: "Design tasks into tracks with work breakdowns and execution order. Writes and maintains PRDs — analyzes feature requests, decomposes into FRs/NFRs, generates DRM-driven documents. Use for new feature planning, PRD writing, architecture changes, multi-track decomposition, or adjusting existing plans. Triggers on 'plan', 'add feature', 'write PRD', 'design tasks'."
argument-hint: "<requirement or feature description>"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, shell, glob, grep
---

# Planner (Gemini)

Follow the canonical protocol at `skills/planner/SKILL.md`.
Reference documents are in `skills/planner/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |

## Setup

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.locale`.
