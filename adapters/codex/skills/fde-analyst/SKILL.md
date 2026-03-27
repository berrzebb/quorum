---
name: quorum-fde-analyst
description: "Analyze failure scenarios for PRD requirements using Failure Driven Engineering. Generates failure tables with severity classification and derives new Work Breakdown items from HIGH/MEDIUM severity failures. Use after DRM confirmation, before WB drafting. Triggers on 'failure analysis', 'FDE', 'analyze failures', '실패 분석', '장애 시나리오', 'what could go wrong'."
argument-hint: "<track name or FR ID>"
model: codex
allowed-tools: read_file, write_file, find_files, search, shell
---

# FDE Analyst (Codex)

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `skills/fde-analyst/SKILL.md`.
