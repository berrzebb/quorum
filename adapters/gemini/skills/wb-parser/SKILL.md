---
name: quorum-wb-parser
description: "Parse work-breakdown files into structured requirements tables. Extracts Req IDs, target files, acceptance criteria, prerequisites, and dependencies. Single responsibility: requirement extraction. Triggers on 'parse WB', 'extract requirements', '요구사항 추출', 'WB 파싱'."
argument-hint: "<track name or path to work-breakdown.md>"
model: gemini-2.0-flash
allowed-tools: read_file, glob, grep
---

# WB Parser (Gemini)

Read-only skill — parses work-breakdown files only.

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |

## Start

Read and follow the canonical skill at `skills/wb-parser/SKILL.md`.
