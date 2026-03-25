---
name: quorum-orchestrator
description: "Session orchestrator — reads handoff, picks unblocked tasks, distributes to parallel workers, manages correction cycles. Use when starting a work session or distributing implementation work. Triggers on 'start session', 'distribute tasks', 'what's next'."
disable-model-invocation: true
model: codex
allowed-tools: read_file, shell, find_files, search
---

# Orchestrator Protocol

You do NOT implement — you distribute, verify, and decide.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |
| Spawn agent | `create_agent` |

## References
Shared references at `skills/orchestrator/references/`. Read the relevant reference before each phase.

| Phase | Reference | When |
|-------|-----------|------|
| Task tiers | `skills/orchestrator/references/tiers.md` | Before spawning |
| Scout / RTM | `skills/orchestrator/references/scout.md` | Tier 2/3 distribution |
| Distribution | `skills/orchestrator/references/distribution.md` | Parallel workers + track closure |
| Correction | `skills/orchestrator/references/correction.md` | On `[pending_tag]` |
| Lifecycle | `skills/orchestrator/references/lifecycle.md` | After `[agree_tag]` + session end |

## Execution Context

**Interactive**: present options, wait for selection. **Headless**: auto-select unblocked, execute, report. In headless mode, NEVER ask questions.

## Setup

Config: `.quorum/config.json` — `consensus.planning_dirs`, `plugin.handoff_file`. Evidence via `audit_submit` MCP tool. Verdicts in **SQLite** via `quorum tool audit_history --summary --json`, NOT markdown files.

## Session Start

1. Parse handoff -> dependency graph -> identify unblocked tasks
2. Check active agents (`agent_id`) -> resumption options
3. User selection (interactive) or auto-select (headless)

## Agent Registry

Track in handoff: `status`, `depends_on`, `blocks`, `agent_id`, `worktree_path`, `worktree_branch`. On spawn: record. On correction: message existing agent. On completion: set `done`.

## Core Loop

```
Tier 1: direct fix -> verify -> commit
Tier 2: scout? -> worktree -> audit -> retro -> merge
Tier 3: mandatory scout -> worktree -> full audit -> regression -> retro
Result: [agree_tag] -> lifecycle.md | [pending_tag] -> correction.md -> loop
```

## Task Distribution

1. Pre-spawn analysis (Tier 2/3):
   ```bash
   quorum tool blast_radius --path . --changed "<task-files>" --json
   ```
2. Compose prompt with context + scout blueprint + blast radius
3. Spawn via `create_agent`, record in handoff, **continue working**

## Result Verification

Query: `quorum tool audit_history --summary --json`. `[agree_tag]` -> lifecycle. `[pending_tag]` -> correction.

## Available Tools (20)

| Category | Tools |
|----------|-------|
| Structure | `code_map`, `dependency_graph`, `blast_radius`, `act_analyze` |
| Quality | `audit_scan`, `coverage_map`, `perf_scan`, `observability_check` |
| Domain | `a11y_scan`, `compat_check`, `i18n_validate`, `license_scan`, `infra_scan`, `doc_coverage` |
| RTM/Audit | `rtm_parse`, `rtm_merge`, `audit_history`, `ai_guide` |

## Anti-Patterns

- Do NOT implement code — spawn workers
- Do NOT spawn new agent for corrections — message existing `agent_id`
- Do NOT distribute overlapping scopes in parallel
- Do NOT exceed 3 concurrent agents
- Do NOT retry 3+ times — escalate or auto-block
- Do NOT skip retrospective or Session Summary
- Do NOT ask questions in headless mode
