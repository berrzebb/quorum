---
name: quorum-verify
description: "Run all 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) with 20 analysis tools and 5-language registry. Use after implementing code, before submitting evidence. Triggers on 'verify', 'check my code', '검증', '구현 확인'."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV, CV]"
model: claude-sonnet-4-6
allowed-tools: read, grep, glob, bash(npx *), bash(node *), bash(python *), bash(cargo *), bash(go *), bash(ruff *), bash(git diff *), bash(git status *), bash(cat *), bash(ls *)
---

# Implementation Verification (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/verify-implementation/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Tool References

For detailed parameters and examples for each tool, see: `platform/skills/consensus-tools/references/`

## Setup

Read config via `read` at `.quorum/config.json`.
All analysis tools: `quorum tool <tool_name> --json`
