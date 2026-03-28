---
name: quorum-scout
description: "Analyze RTM data to produce gap reports, cross-track audits, and bidirectional summaries. Consumes structured output from wb-parser and rtm-scanner. Single responsibility: requirement gap analysis. Triggers on 'scout', 'gap report', 'RTM analysis', 'RTM 분석', '갭 보고서'."
model: gemini-2.5-pro
allowed-tools: read_file, shell, glob, grep
---

# Scout (Gemini)

Follow the canonical protocol at `platform/skills/scout/SKILL.md`.
Core protocol: `agents/knowledge/scout-protocol.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |

## Tool References

For detailed parameters and examples: `platform/skills/consensus-tools/references/`
