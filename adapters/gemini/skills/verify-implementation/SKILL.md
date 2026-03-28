---
name: quorum-verify
description: "Run all 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) with 20 analysis tools and 5-language registry. Produces a pass/fail verification report. Use after implementing code, before submitting evidence to audit. Triggers on 'verify', 'check my code', 'run done-criteria', 'am I ready to submit'."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV, CV]"
model: gemini-2.5-pro
allowed-tools: read_file, write_file, shell, glob, grep
---

# Implementation Verification (Gemini)

Follow the canonical protocol at `skills/verify-implementation/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |

## Tool References

For detailed parameters and examples for each tool, see: `skills/consensus-tools/references/`

## Setup

Read config via `read_file` at `core/config.json`.
All analysis tools: `quorum tool <tool_name> --json`
