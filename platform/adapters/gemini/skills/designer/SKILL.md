---
name: quorum-designer
description: "Generate and validate design documents (Spec, Blueprint, Domain Model, Architecture) with mandatory mermaid diagrams. Use this skill after PRD confirmation when the DRM requires Design Phase artifacts. Triggers on 'generate design', 'design docs', 'create spec', 'create blueprint', '설계 문서', '설계 생성', 'design phase'."
argument-hint: "<track name>"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, edit_file, glob, grep, run_shell_command
---

# Designer (Gemini)

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `edit_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `platform/skills/designer/SKILL.md`.
