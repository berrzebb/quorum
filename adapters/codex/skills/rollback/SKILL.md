---
name: quorum-rollback
description: "Manage state recovery through checkpoints. List, create, and restore checkpoints for Wave execution, track progress, and planning state. Provides structural safety net for quorum workflows. Triggers on 'rollback', 'restore', 'checkpoint', 'undo', 'recover', '롤백', '복구', '체크포인트', '되돌리기'."
argument-hint: "<action: list|create|restore> [checkpoint-id]"
model: codex
allowed-tools: read_file, write_file, find_files, shell
---

# Rollback (Codex)

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `find_files` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `platform/skills/rollback/SKILL.md`.
