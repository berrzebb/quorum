---
name: quorum:self-checker
description: "Run pre-audit self-verification on implemented code — CQ (lint/types), T (tests), CC (changed files match claim), S (security), I (i18n). Zero LLM tokens — uses only deterministic tools. Catches issues before expensive audit round-trips. Triggers on 'self check', 'pre-audit', 'verify before submit', '자가 검증', '제출 전 확인', 'oracle check'."
argument-hint: "<changed files or 'auto' to detect from git diff>"
model: claude-haiku-4-5-20251001
allowed-tools: Read, Glob, Grep, Bash(node *), Bash(quorum *), Bash(npx *), Bash(git *)
---

# Self-Checker (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/self-checker/SKILL.md`.
