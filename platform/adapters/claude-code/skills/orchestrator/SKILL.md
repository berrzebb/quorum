---
name: quorum:orchestrator
description: "Session orchestrator for quorum — reads handoff, picks unblocked tasks, distributes to parallel workers, tracks agent assignments, manages correction cycles. Use when starting a work session, distributing implementation work, reviewing completed output, or managing multi-agent workflows. Triggers on 'start session', 'distribute tasks', 'what's next', 'assign work', '세션 시작', 'orchestrate'."
argument-hint: "[optional: task-id to assign]"
disable-model-invocation: true
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(git *)
---

# Orchestrator (Claude Code)

Follow the canonical protocol at `platform/skills/orchestrator/SKILL.md`.
Reference documents are in `platform/skills/orchestrator/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |
| Spawn agent | `Task` with `run_in_background: true` |
| Message agent | `SendMessage` |

## Setup

Read config: `${CLAUDE_PLUGIN_ROOT}/../../core/config.json`
- `audit_submit` MCP tool — evidence submission
- `consensus.planning_dirs` — design document directories
- `plugin.handoff_file` — session handoff path (default: `.claude/session-handoff.md`)

Context files:
- Done criteria: `${CLAUDE_PLUGIN_ROOT}/../../core/templates/references/${locale}/done-criteria.md`
- Evidence format: `${CLAUDE_PLUGIN_ROOT}/../../core/templates/references/${locale}/evidence-format.md`

Verdicts are in **SQLite** — query via `audit_history` tool or `quorum status`, not from markdown files.

All analysis tools: `node ${CLAUDE_PLUGIN_ROOT}/../../core/tools/tool-runner.mjs <tool_name> --json`

## Adapter-Specific Notes

- Agent spawn: `subagent_type: "quorum:implementer"`, `isolation: "worktree"`, `run_in_background: true`
- Correction: `SendMessage` to existing `agent_id` — never spawn new agent
- Resume: `SendMessage` to resume `in-progress` tasks
