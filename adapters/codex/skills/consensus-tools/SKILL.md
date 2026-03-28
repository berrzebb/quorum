---
name: quorum-tools
description: "Run any of the 20 quorum analysis tools via CLI — codebase, quality, domain checks, RTM/FVM, and audit_history. Use whenever you need code analysis or domain checks. Triggers on 'run tool', 'scan code', 'check dependencies'."
argument-hint: "<tool_name> [context or parameters]"
model: codex
allowed-tools: read_file, shell
---

# quorum-tools (Codex)

Follow the canonical protocol at `skills/consensus-tools/SKILL.md`.
References at `skills/consensus-tools/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |

## Setup

Invocation:
```bash
quorum tool <tool_name> --param value ...
```

Fallback: `node core/tools/tool-runner.mjs <tool_name> --param value ...`
