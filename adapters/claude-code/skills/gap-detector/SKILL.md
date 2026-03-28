---
name: quorum:gap-detector
description: "Detect gaps between design documents and actual implementation. Compares Spec, Blueprint, Domain Model against codebase to produce a Match Rate and gap report. Different from audit — this checks design intent vs code reality. Triggers on 'check gaps', 'design vs code', 'match rate', 'implementation gaps', '설계 갭', '구현 확인', '매치율'."
argument-hint: "<track name or design directory path>"
model: claude-sonnet-4-6
allowed-tools: Read, Glob, Grep, Bash(node *), Bash(quorum *)
---

# Gap Detector (Claude Code)

Read-only skill — does not modify code or design documents.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Start

Read and follow the canonical skill at `platform/skills/gap-detector/SKILL.md`.
