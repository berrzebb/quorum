---
name: quorum:designer
description: "Generate and validate design documents (Spec, Blueprint, Domain Model, Architecture) with mandatory mermaid diagrams. Use this skill after PRD confirmation when the DRM requires Design Phase artifacts. Triggers on 'generate design', 'design docs', 'create spec', 'create blueprint', '설계 문서', '설계 생성', 'design phase'."
argument-hint: "<track name>"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node *), Bash(quorum *)
---

# Designer (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Edit file | `Edit` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/designer/SKILL.md`.

## Execute

Run blueprint validation after generating design documents:

```bash
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs blueprint_lint --path <design-dir>
```
