---
name: quorum-wb-parser
description: "Parse work-breakdown files into structured requirements tables. Extracts Req IDs, target files, acceptance criteria, prerequisites, and dependencies. Single responsibility: requirement extraction. Triggers on 'parse WB', 'extract requirements', '요구사항 추출', 'WB 파싱'."
argument-hint: "<track name or path to work-breakdown.md>"
allowed-tools: read, glob, grep
---

# WB Parser (OpenAI Compatible)

Read-only skill — parses work-breakdown files only.

## OpenAI Compatible Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |

## Start

Read and follow the canonical skill at `platform/skills/wb-parser/SKILL.md`.
