---
name: quorum:merge
description: "Squash-merge a worktree branch into target with structured commit message. Use after audit consensus and retrospective. Triggers on 'merge worktree', 'squash merge', 'finalize work', '워크트리 머지'."
argument-hint: "[target-branch]"
disable-model-invocation: true
model: claude-sonnet-4-6
context: fork
allowed-tools: Read, Grep, Glob, Bash(git *)
---

# Merge Worktree (Claude Code)

Follow the canonical protocol at `skills/merge-worktree/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |
| Spawn doc-sync | `Agent` |

## Setup

Config: `.quorum/config.json` — `consensus.agree_tag`, `plugin.locale`.
