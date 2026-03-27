---
name: quorum-rtm-scanner
description: "Trace requirements against codebase using deterministic tools. Takes structured requirements from wb-parser, runs code_map/dependency_graph/coverage_map per requirement, outputs raw RTM rows. Single responsibility: tool-based tracing. Triggers on 'scan RTM', 'trace requirements', 'RTM 스캔', '추적성 검사'."
argument-hint: "<path to requirements table or track name>"
allowed-tools: read, glob, grep, bash
---

# RTM Scanner (OpenAI-Compatible)

## OpenAI-Compatible Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `skills/rtm-scanner/SKILL.md`.
