---
name: quorum-designer
description: "Generate and validate design documents (Spec, Blueprint, Domain Model, Architecture) with mandatory mermaid diagrams. Use this skill after PRD confirmation when the DRM requires Design Phase artifacts. Triggers on 'generate design', 'design docs', 'create spec', 'create blueprint', '설계 문서', '설계 생성', 'design phase'."
argument-hint: "<track name>"
model: codex
allowed-tools: read_file, write_file, apply_diff, find_files, search, shell
---

# Designer (Codex)

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `platform/skills/designer/SKILL.md`.
