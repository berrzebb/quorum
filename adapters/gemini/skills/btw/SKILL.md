---
name: quorum-btw
description: "Record improvement ideas during work sessions for later analysis and skill promotion. Captures suggestions without interrupting workflow. Integrates with auto-learn pattern detection. Triggers on 'btw', 'by the way', 'idea', 'suggestion', 'improvement', '아이디어', '제안', '개선', '나중에', 'note to self'."
argument-hint: "<idea or suggestion text>"
model: gemini-2.0-flash
allowed-tools: read_file, write_file, glob, run_shell_command
---

# BTW — By-The-Way Suggestions (Gemini)

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `skills/btw/SKILL.md`.
