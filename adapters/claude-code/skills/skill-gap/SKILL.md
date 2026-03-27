---
name: quorum:skill-gap
description: "Analyze CPS/PRD to identify which skills and tools are needed for a track. Compares requirements against the skill catalog to find COVERED/PARTIAL/GAP status. Single responsibility: skill need identification. Triggers on 'skill gap', 'what skills needed', 'analyze needs', '스킬 갭', '필요 스킬', '어떤 도구가 필요해'."
argument-hint: "<track name or CPS/PRD path>"
model: claude-haiku-4-5-20251001
allowed-tools: Read, Glob, Grep
---

# Skill Gap (Claude Code)

Read-only skill — does not modify code or design documents.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |

## Start

Read and follow the canonical skill at `skills/skill-gap/SKILL.md`.
