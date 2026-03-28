---
name: quorum-skill-status
description: "Report loaded skill inventory across canonical and adapter layers. Detects missing wrappers, trigger conflicts, and description mismatches. Use for plugin diagnostics and skill health checks. Triggers on 'skill status', 'skill list', 'loaded skills', 'skill inventory', '스킬 상태', '스킬 목록', '스킬 진단'."
model: gemini-2.5-pro
allowed-tools: read_file, glob, grep
---

# Skill Status (Gemini)

Read-only skill — scans files only, never modifies.

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |

## Start

Read and follow the canonical skill at `platform/skills/skill-status/SKILL.md`.
