---
name: quorum-merge
description: "Squash-merge a worktree branch into target with structured commit message. Use after audit consensus and retrospective. Triggers on 'merge worktree', 'squash merge', 'finalize work', '워크트리 머지'."
argument-hint: "[target-branch]"
disable-model-invocation: true
model: claude-sonnet-4-6
context: fork
allowed-tools: read, grep, glob, bash(git *)
---

# Merge Worktree (OpenAI-Compatible)

Follow the canonical protocol at `skills/merge-worktree/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Setup

Config: `.quorum/config.json` — `consensus.agree_tag`, `plugin.locale`.
