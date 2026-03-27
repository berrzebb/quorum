---
name: quorum-qa-strategist
description: "Define quality thresholds per phase and coordinate verification roles. Parliament-aware: includes Confluence 4-point checks, Amendment resolution, Normal Form convergence. Single responsibility: quality criteria definition and delegation. Triggers on 'quality strategy', 'QA plan', 'check criteria', '품질 전략', '검증 기준', 'what should we check'."
argument-hint: "<track name or phase>"
model: gemini-2.5-pro
allowed-tools: read_file, glob, grep, run_shell_command
---

# QA Strategist (Gemini)

Read-only skill — does not modify code or design documents.

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `run_shell_command` |

## Start

Read and follow the canonical skill at `skills/qa-strategist/SKILL.md`.
