---
name: quorum-self-checker
description: "Run pre-audit self-verification on implemented code — CQ (lint/types), T (tests), CC (changed files match claim), S (security), I (i18n). Zero LLM tokens — uses only deterministic tools. Catches issues before expensive audit round-trips. Triggers on 'self check', 'pre-audit', 'verify before submit', '자가 검증', '제출 전 확인', 'oracle check'."
argument-hint: "<changed files or 'auto' to detect from git diff>"
allowed-tools: read, glob, grep, bash
---

# Self-Checker (OpenAI-Compatible)

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `platform/skills/self-checker/SKILL.md`.
