---
name: quorum-orchestrator
description: "Session orchestrator — reads handoff, distributes tasks to parallel workers, manages correction cycles. Use when starting a work session or distributing work. Triggers on 'start session', 'distribute tasks', 'what's next', 'orchestrate'."
argument-hint: "[optional: task-id]"
disable-model-invocation: true
model: gemini-2.5-pro
allowed-tools: read_file, shell, glob, grep
---

# Orchestrator (Gemini)

Follow the canonical protocol at `platform/skills/orchestrator/SKILL.md`.
Reference documents are in `platform/skills/orchestrator/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |
| Spawn worker | `spawn_agent` |

## Setup

Read config: `.quorum/config.json`
- `audit_submit` MCP tool — evidence submission
- `consensus.planning_dirs` — design document directories
- `plugin.handoff_file` — session handoff path (default: `.claude/session-handoff.md`)

Verdicts are in **SQLite** — query via `quorum tool audit_history` or `quorum status`, NOT from markdown files.

All analysis tools: `quorum tool <tool_name> --json`
