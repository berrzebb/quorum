---
name: quorum:rtm-scanner
description: "Trace requirements against codebase using deterministic tools. Takes structured requirements from wb-parser, runs code_map/dependency_graph/coverage_map per requirement, outputs raw RTM rows. Single responsibility: tool-based tracing. Triggers on 'scan RTM', 'trace requirements', 'RTM 스캔', '추적성 검사'."
argument-hint: "<path to requirements table or track name>"
model: claude-haiku-4-5-20251001
allowed-tools: Read, Glob, Grep, Bash(node *), Bash(quorum *)
---

# RTM Scanner (Claude Code)

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `skills/rtm-scanner/SKILL.md`.
