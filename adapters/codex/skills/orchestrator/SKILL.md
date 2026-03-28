---
name: quorum-orchestrator
description: "Session orchestrator — reads handoff, picks unblocked tasks, distributes to parallel workers, manages correction cycles. Use when starting a work session or distributing implementation work. Triggers on 'start session', 'distribute tasks', 'what's next'."
disable-model-invocation: true
model: codex
allowed-tools: read_file, shell, find_files, search
---

# Orchestrator (Codex)

Follow the canonical protocol at `skills/orchestrator/SKILL.md`.
Reference documents are in `skills/orchestrator/references/`.

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

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.handoff_file`.
Evidence via `audit_submit` MCP tool.
Verdicts in **SQLite** via `quorum tool audit_history --summary --json`, NOT markdown files.

All analysis tools: `quorum tool <tool_name> --json`
