---
name: quorum-fixer
description: "Address specific audit findings with targeted fixes. Different from implementer — no fresh implementation, only surgical fixes to identified issues. Reads audit rejection codes, applies corrections, re-verifies. Spawned by orchestrator when Wave audit fails. Triggers on 'fix audit', 'fix findings', 'correction round', '수정', '감사 수정', 'fix rejection', 'address findings'."
argument-hint: "<audit findings or 'auto' to read from audit_history>"
model: codex
allowed-tools: read_file, write_file, apply_diff, find_files, search, shell
---

# Fixer (Codex)

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `platform/skills/fixer/SKILL.md`.
