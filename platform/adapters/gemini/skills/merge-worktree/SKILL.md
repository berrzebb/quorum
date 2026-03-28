---
name: quorum-merge
description: "Squash-merge a worktree branch into target with structured commit message. Use after audit consensus and retrospective. Triggers on 'merge worktree', 'squash merge', 'finalize work'."
argument-hint: "[target-branch]"
disable-model-invocation: true
model: gemini-2.5-pro
context: fork
allowed-tools: read_file, glob, grep, shell
---

# Merge Worktree (Gemini)

Follow the canonical protocol at `platform/skills/merge-worktree/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |

## Setup

Config: `.quorum/config.json` — `consensus.agree_tag`, `plugin.locale`.
