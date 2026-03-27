---
name: quorum:rollback
description: "Manage state recovery through checkpoints. List, create, and restore checkpoints for Wave execution, track progress, and planning state. Provides structural safety net for quorum workflows. Triggers on 'rollback', 'restore', 'checkpoint', 'undo', 'recover', '롤백', '복구', '체크포인트', '되돌리기'."
argument-hint: "<action: list|create|restore> [checkpoint-id]"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Glob, Bash(node *), Bash(git *)
---

# Rollback (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/rollback/SKILL.md`.
