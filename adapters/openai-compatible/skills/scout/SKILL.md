---
name: quorum-scout
description: "Analyze RTM data to produce gap reports, cross-track audits, and bidirectional summaries. Consumes structured output from wb-parser and rtm-scanner. Single responsibility: requirement gap analysis. Triggers on 'scout', 'gap report', 'RTM analysis', 'RTM 분석', '갭 보고서'."
model: default
allowed-tools: read, bash, glob, grep
---

# Scout (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/scout/SKILL.md`.
Core protocol: `agents/knowledge/scout-protocol.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `bash` |

## Tool References

For detailed parameters and examples: `platform/skills/consensus-tools/references/`
