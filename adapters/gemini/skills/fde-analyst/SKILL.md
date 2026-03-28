---
name: quorum-fde-analyst
description: "Analyze failure scenarios for PRD requirements using Failure Driven Engineering. Generates failure tables with severity classification and derives new Work Breakdown items from HIGH/MEDIUM severity failures. Use after DRM confirmation, before WB drafting. Triggers on 'failure analysis', 'FDE', 'analyze failures', '실패 분석', '장애 시나리오', 'what could go wrong'."
argument-hint: "<track name or FR ID>"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, glob, grep, run_shell_command
---

# FDE Analyst (Gemini)

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `platform/skills/fde-analyst/SKILL.md`.
