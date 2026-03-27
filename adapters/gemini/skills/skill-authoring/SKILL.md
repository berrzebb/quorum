---
name: quorum-skill-authoring
description: "Create new quorum skills following the canonical + pointer wrapper architecture. Generates the shared skill at skills/{name}/ and adapter wrappers for all 4 adapters (claude-code, gemini, codex, openai-compatible). Use this skill whenever creating, scaffolding, or adding a new skill to the quorum project. Triggers on 'create skill', 'new skill', 'add skill', 'scaffold skill', '스킬 만들기', '스킬 추가', '새 스킬'."
argument-hint: "<skill name and purpose>"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, glob, grep, run_shell_command
---

# Quorum Skill Authoring (Gemini)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `skills/skill-authoring/SKILL.md`.
