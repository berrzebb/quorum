---
name: quorum-gap-detector
description: "Detect gaps between design documents and actual implementation. Compares Spec, Blueprint, Domain Model against codebase to produce a Match Rate and gap report. Different from audit — this checks design intent vs code reality. Triggers on 'check gaps', 'design vs code', 'match rate', 'implementation gaps', '설계 갭', '구현 확인', '매치율'."
argument-hint: "<track name or design directory path>"
allowed-tools: read, glob, grep, bash
---

# Gap Detector (OpenAI-Compatible)

Read-only skill — does not modify code or design documents.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Start

Read and follow the canonical skill at `platform/skills/gap-detector/SKILL.md`.
