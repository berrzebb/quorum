---
name: quorum-merge
description: "Squash-merge a worktree branch into target with structured commit message. Use after audit consensus and retrospective completion. Triggers on 'merge worktree', 'squash merge', 'finalize work'."
argument-hint: "[target-branch]"
disable-model-invocation: true
model: codex
context: fork
allowed-tools: read_file, find_files, search, shell
---

# Merge Worktree (Codex)

Follow the canonical protocol at `platform/skills/merge-worktree/SKILL.md`.

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

Config: `.quorum/config.json` — `consensus.agree_tag`, `plugin.locale`.
