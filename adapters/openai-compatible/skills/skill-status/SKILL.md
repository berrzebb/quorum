---
name: quorum-skill-status
description: "Report loaded skill inventory across canonical and adapter layers. Detects missing wrappers, trigger conflicts, and description mismatches. Use for plugin diagnostics and skill health checks. Triggers on 'skill status', 'skill list', 'loaded skills', 'skill inventory', '스킬 상태', '스킬 목록', '스킬 진단'."
allowed-tools: read, glob, grep
---

# Skill Status (OpenAI-Compatible)

Read-only skill — scans files only, never modifies.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |

## Start

Read and follow the canonical skill at `skills/skill-status/SKILL.md`.
