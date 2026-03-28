---
name: quorum-verify
description: "Run all 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) with 20 analysis tools and 5-language registry. Use after implementing code, before submitting evidence. Triggers on 'verify', 'check my code', 'run done-criteria'."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV, CV]"
model: codex
allowed-tools: read_file, write_file, shell, find_files, search
---

# Implementation Verification (Codex)

Follow the canonical protocol at `platform/skills/verify-implementation/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |

## Tool References

For detailed parameters and examples for each tool, see: `platform/skills/consensus-tools/references/`

## Setup

Read config via `read_file` at `platform/core/config.json`.
All analysis tools: `quorum tool <tool_name> --json`
