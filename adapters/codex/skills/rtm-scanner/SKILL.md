---
name: quorum-rtm-scanner
description: "Trace requirements against codebase using deterministic tools. Takes structured requirements from wb-parser, runs code_map/dependency_graph/coverage_map per requirement, outputs raw RTM rows. Single responsibility: tool-based tracing. Triggers on 'scan RTM', 'trace requirements', 'RTM 스캔', '추적성 검사'."
argument-hint: "<path to requirements table or track name>"
model: codex
allowed-tools: read_file, find_files, search, shell
---

# RTM Scanner (Codex)

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `skills/rtm-scanner/SKILL.md`.
