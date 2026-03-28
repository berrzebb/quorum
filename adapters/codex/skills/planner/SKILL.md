---
name: quorum-planner
description: "Design tasks into tracks with work breakdowns. Writes and maintains PRDs, generates DRM-driven documents. Use for feature planning, PRD writing, or adjusting existing plans. Triggers on 'plan', 'add feature', 'write PRD', 'design tasks'."
argument-hint: "<requirement or feature description>"
model: codex
allowed-tools: read_file, write_file, shell, find_files, search
---

# Planner (Codex)

Follow the canonical protocol at `platform/skills/planner/SKILL.md`.
Reference documents are in `platform/skills/planner/references/`.

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

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.locale`.
