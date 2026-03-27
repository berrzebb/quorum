---
name: quorum-gap-detector
description: "Detect gaps between design documents and actual implementation. Compares Spec, Blueprint, Domain Model against codebase to produce a Match Rate and gap report. Different from audit — this checks design intent vs code reality. Triggers on 'check gaps', 'design vs code', 'match rate', 'implementation gaps', '설계 갭', '구현 확인', '매치율'."
argument-hint: "<track name or design directory path>"
model: codex
allowed-tools: read_file, find_files, search, shell
---

# Gap Detector (Codex)

Read-only skill — does not modify code or design documents.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `find_files` |
| Search content | `search` |
| Run command | `shell` |

## Start

Read and follow the canonical skill at `skills/gap-detector/SKILL.md`.
