---
name: quorum-fixer
description: "Address specific audit findings with targeted fixes. Different from implementer — no fresh implementation, only surgical fixes to identified issues. Reads audit rejection codes, applies corrections, re-verifies. Spawned by orchestrator when Wave audit fails. Triggers on 'fix audit', 'fix findings', 'correction round', '수정', '감사 수정', 'fix rejection', 'address findings'."
argument-hint: "<audit findings or 'auto' to read from audit_history>"
allowed-tools: read, write, edit, glob, grep, bash
---

# Fixer (OpenAI-Compatible)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Edit file | `edit` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `skills/fixer/SKILL.md`.
