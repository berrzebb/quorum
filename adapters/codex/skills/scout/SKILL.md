---
name: quorum-scout
description: "Analyze RTM data to produce gap reports, cross-track audits, and bidirectional summaries. Consumes structured output from wb-parser and rtm-scanner. Single responsibility: requirement gap analysis. Triggers on 'scout', 'gap report', 'RTM analysis', 'RTM 분석', '갭 보고서'."
model: codex
allowed-tools: read_file, write_file, find_files, search
---

# Scout (Codex)

Analyzes RTM rows (from rtm-scanner) to produce gap reports. Phase 5-8 of the original scout pipeline.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Find files | `find_files` |
| Search content | `search` |

## Output Files

| File | Content |
|------|---------|
| `{planning_dir}/rtm-{domain}.md` | 3-section RTM (Forward, Backward, Bidirectional) |
| `{planning_dir}/gap-report-{domain}.md` | Requirements without tests + tests without requirements |
| `{planning_dir}/cross-track-connections.md` | Import paths crossing track boundaries |

## Key Rules

- **Read-only** — do NOT modify any source code files
- **All 3 RTM sections required** — Forward, Backward, and Bidirectional. Do NOT exit without all 3
- **Use tool results directly** — do NOT manually trace imports (use `dependency_graph`), do NOT manually check file existence (use `code_map`), do NOT manually parse coverage (use `coverage_map`)
- **Do NOT invent Req IDs** — extract from work-breakdown only
- **Do NOT assume status** — verify every row with tools
- Verdicts live in **SQLite** — do NOT look for verdict.md or gpt.md

## Tool References

For detailed parameters and examples for each tool, see: `platform/skills/consensus-tools/references/`
