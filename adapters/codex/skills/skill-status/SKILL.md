---
name: quorum-skill-status
description: "Report loaded skill inventory across canonical and adapter layers. Detects missing wrappers, trigger conflicts, and description mismatches. Use for plugin diagnostics and skill health checks. Triggers on 'skill status', 'skill list', 'loaded skills', 'skill inventory', '스킬 상태', '스킬 목록', '스킬 진단'."
model: codex
allowed-tools: read_file, find_files, search
---

# Skill Status (Codex)

Read-only skill — scans files only, never modifies.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `find_files` |
| Search content | `search` |

## Start

Read and follow the canonical skill at `skills/skill-status/SKILL.md`.
