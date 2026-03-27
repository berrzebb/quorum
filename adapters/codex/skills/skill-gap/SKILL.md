---
name: quorum-skill-gap
description: "Analyze CPS/PRD to identify which skills and tools are needed for a track. Compares requirements against the skill catalog to find COVERED/PARTIAL/GAP status. Single responsibility: skill need identification. Triggers on 'skill gap', 'what skills needed', 'analyze needs', '스킬 갭', '필요 스킬', '어떤 도구가 필요해'."
argument-hint: "<track name or CPS/PRD path>"
model: codex
allowed-tools: read_file, find_files, search
---

# Skill Gap (Codex)

Read-only skill — does not modify code or design documents.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `find_files` |
| Search content | `search` |

## Start

Read and follow the canonical skill at `skills/skill-gap/SKILL.md`.
