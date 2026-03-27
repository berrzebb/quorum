---
name: quorum:wb-parser
description: "Parse work-breakdown files into structured requirements tables. Extracts Req IDs, target files, acceptance criteria, prerequisites, and dependencies. Single responsibility: requirement extraction. Triggers on 'parse WB', 'extract requirements', '요구사항 추출', 'WB 파싱'."
argument-hint: "<track name or path to work-breakdown.md>"
model: claude-haiku-4-5-20251001
allowed-tools: Read, Glob, Grep
---

# WB Parser (Claude Code)

Read-only skill — parses work-breakdown files only.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |

## Start

Read and follow the canonical skill at `skills/wb-parser/SKILL.md`.
