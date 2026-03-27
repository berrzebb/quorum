---
name: quorum:fde-analyst
description: "Analyze failure scenarios for PRD requirements using Failure Driven Engineering. Generates failure tables with severity classification and derives new Work Breakdown items from HIGH/MEDIUM severity failures. Use after DRM confirmation, before WB drafting. Triggers on 'failure analysis', 'FDE', 'analyze failures', '실패 분석', '장애 시나리오', 'what could go wrong'."
argument-hint: "<track name or FR ID>"
model: claude-sonnet-4-6
allowed-tools: Read, Write, Glob, Grep, Bash(node *), Bash(quorum *)
---

# FDE Analyst (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/fde-analyst/SKILL.md`.
