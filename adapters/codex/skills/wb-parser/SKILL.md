---
name: quorum-wb-parser
description: "Parse work-breakdown files into structured requirements tables. Extracts Req IDs, target files, acceptance criteria, prerequisites, and dependencies. Single responsibility: requirement extraction. Triggers on 'parse WB', 'extract requirements', '요구사항 추출', 'WB 파싱'."
argument-hint: "<track name or path to work-breakdown.md>"
model: codex
allowed-tools: read_file, find_files, search
---

# WB Parser (Codex)

Read-only skill — parses work-breakdown files only.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `find_files` |
| Search content | `search` |

## Start

Read and follow the canonical skill at `skills/wb-parser/SKILL.md`.
