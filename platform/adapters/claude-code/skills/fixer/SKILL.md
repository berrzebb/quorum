---
name: quorum:fixer
description: "Address specific audit findings with targeted fixes. Different from implementer — no fresh implementation, only surgical fixes to identified issues. Reads audit rejection codes, applies corrections, re-verifies. Spawned by orchestrator when Wave audit fails. Triggers on 'fix audit', 'fix findings', 'correction round', '수정', '감사 수정', 'fix rejection', 'address findings'."
argument-hint: "<audit findings or 'auto' to read from audit_history>"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(quorum *), Bash(npx *), Bash(git *)
---

# Fixer (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Edit file | `Edit` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `platform/skills/fixer/SKILL.md`.
