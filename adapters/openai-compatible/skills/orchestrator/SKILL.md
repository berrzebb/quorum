---
name: quorum-orchestrator
description: "Session orchestrator for quorum — reads handoff, picks unblocked tasks, distributes to parallel workers, tracks agent assignments, manages correction cycles. Use when starting a work session, distributing implementation work, reviewing completed output, or managing multi-agent workflows. Triggers on 'start session', 'distribute tasks', 'what's next', 'assign work', '세션 시작', 'orchestrate'."
argument-hint: "[optional: task-id to assign]"
disable-model-invocation: true
model: claude-sonnet-4-6
allowed-tools: read, grep, glob, bash(node *), bash(git *)
---

# Orchestrator (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/orchestrator/SKILL.md`.
Reference documents are in `platform/skills/orchestrator/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |
| Spawn agent | `task` with `run_in_background: true` |

## Setup

Read config: `${ADAPTER_ROOT}/core/config.json`
- `audit_submit` MCP tool — evidence submission
- `consensus.planning_dirs` — design document directories
- `plugin.handoff_file` — session handoff path (default: `.claude/session-handoff.md`)

Context files:
- Done criteria: `${ADAPTER_ROOT}/core/templates/references/${locale}/done-criteria.md`
- Evidence format: `${ADAPTER_ROOT}/core/templates/references/${locale}/evidence-format.md`

Verdicts are in **SQLite** — query via `audit_history` tool or `quorum status`, not from markdown files.

All analysis tools: `node ${ADAPTER_ROOT}/core/tools/tool-runner.mjs <tool_name> --json`

## Adapter-Specific Notes

- Agent spawn: `subagent_type: "quorum:implementer"`, `isolation: "worktree"`, `run_in_background: true`
- Correction: message existing `agent_id` — never spawn new agent
