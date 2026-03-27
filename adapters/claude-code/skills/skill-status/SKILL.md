---
name: quorum:skill-status
description: "Report loaded skill inventory across canonical and adapter layers. Detects missing wrappers, trigger conflicts, and description mismatches. Use for plugin diagnostics and skill health checks. Triggers on 'skill status', 'skill list', 'loaded skills', 'skill inventory', '스킬 상태', '스킬 목록', '스킬 진단'."
model: claude-sonnet-4-6
allowed-tools: Read, Glob, Grep
---

# Skill Status (Claude Code)

Read-only skill — scans files only, never modifies.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |

## Start

Read and follow the canonical skill at `skills/skill-status/SKILL.md`.
