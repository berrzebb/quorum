---
name: quorum-designer
description: "Generate and validate design documents (Spec, Blueprint, Domain Model, Architecture) with mandatory mermaid diagrams. Use this skill after PRD confirmation when the DRM requires Design Phase artifacts. Triggers on 'generate design', 'design docs', 'create spec', 'create blueprint', '설계 문서', '설계 생성', 'design phase'."
argument-hint: "<track name>"
allowed-tools: read, write, edit, glob, grep, bash
---

# Designer (OpenAI-Compatible)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Edit file | `edit` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `skills/designer/SKILL.md`.
