---
name: quorum-qa-strategist
description: "Define quality thresholds per phase and coordinate verification roles. Parliament-aware: includes Confluence 4-point checks, Amendment resolution, Normal Form convergence. Single responsibility: quality criteria definition and delegation. Triggers on 'quality strategy', 'QA plan', 'check criteria', '품질 전략', '검증 기준', 'what should we check'."
argument-hint: "<track name or phase>"
model: codex
allowed-tools: read_file, find_files, search, shell
---

# QA Strategist (Codex)

Read-only skill — does not modify code or design documents.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `platform/skills/qa-strategist/SKILL.md`.
