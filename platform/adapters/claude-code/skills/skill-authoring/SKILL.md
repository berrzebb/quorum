---
name: quorum:skill-authoring
description: "Create new quorum skills following the canonical + pointer wrapper architecture. Generates the shared skill at skills/{name}/ and adapter wrappers for all 4 adapters (claude-code, gemini, codex, openai-compatible). Use this skill whenever creating, scaffolding, or adding a new skill to the quorum project. Triggers on 'create skill', 'new skill', 'add skill', 'scaffold skill', '스킬 만들기', '스킬 추가', '새 스킬'."
argument-hint: "<skill name and purpose>"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Glob, Grep, Bash(node *)
---

# Quorum Skill Authoring (Claude Code)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `platform/skills/skill-authoring/SKILL.md`.
