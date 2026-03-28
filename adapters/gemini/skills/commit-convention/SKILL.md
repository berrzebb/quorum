---
name: quorum-commit-convention
description: "Git commit best practices — analyzes staged changes, determines split boundaries, and writes Conventional Commits messages. Use this skill before any git commit, when reviewing staged changes, or when asking how to write commit messages. Project CLAUDE.md conventions take precedence. Triggers on 'commit', 'git commit', 'commit message', 'how should I commit', '커밋', '커밋 메시지', '커밋 컨벤션'."
argument-hint: "[--check | --split-advice]"
model: gemini-2.5-pro
allowed-tools: read_file, shell
---

# Commit Convention (Gemini)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `platform/skills/commit-convention/SKILL.md`.
