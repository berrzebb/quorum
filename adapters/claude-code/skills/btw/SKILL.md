---
name: quorum:btw
description: "Record improvement ideas during work sessions for later analysis and skill promotion. Captures suggestions without interrupting workflow. Integrates with auto-learn pattern detection. Triggers on 'btw', 'by the way', 'idea', 'suggestion', 'improvement', '아이디어', '제안', '개선', '나중에', 'note to self'."
argument-hint: "<idea or suggestion text>"
model: claude-haiku-4-5-20251001
allowed-tools: Read, Write, Glob, Bash(node *)
---

# BTW — By-The-Way Suggestions (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/btw/SKILL.md`.
