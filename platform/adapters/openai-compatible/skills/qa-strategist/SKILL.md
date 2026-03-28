---
name: quorum-qa-strategist
description: "Define quality thresholds per phase and coordinate verification roles. Parliament-aware: includes Confluence 4-point checks, Amendment resolution, Normal Form convergence. Single responsibility: quality criteria definition and delegation. Triggers on 'quality strategy', 'QA plan', 'check criteria', '품질 전략', '검증 기준', 'what should we check'."
argument-hint: "<track name or phase>"
allowed-tools: read, glob, grep, bash
---

# QA Strategist (OpenAI-Compatible)

Read-only skill — does not modify code or design documents.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `platform/skills/qa-strategist/SKILL.md`.
