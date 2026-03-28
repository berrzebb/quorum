---
name: quorum:verify
description: "Run all 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) with 20 analysis tools and 5-language registry. Use after implementing code, before submitting evidence. Triggers on 'verify', 'check my code', '검증', '구현 확인'."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV, CV]"
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(npx *), Bash(node *), Bash(python *), Bash(cargo *), Bash(go *), Bash(ruff *), Bash(git diff *), Bash(git status *), Bash(cat *), Bash(ls *)
---

# Implementation Verification (Claude Code)

Follow the canonical protocol at `skills/verify-implementation/SKILL.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Tool References

For detailed parameters and examples for each tool, see: `skills/consensus-tools/references/`

## Setup

Read config via `Read` at `.quorum/config.json`.
All analysis tools: `quorum tool <tool_name> --json`

## Adapter-Specific Notes

- **Contract Drift (CD)** is a mandatory 9th category for Claude Code. Run `contract_drift` tool — any `critical` finding rejects the submission. No exceptions.
- Full tool inventory: 22 tools (20 base + `contract_drift` + `fvm_validate`).
