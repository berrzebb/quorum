---
name: quorum-tools
description: "Run any of the 20 quorum analysis tools via CLI — codebase, quality, domain checks, RTM/FVM, and audit_history. Use whenever you need code analysis or domain checks. Triggers on 'run tool', 'scan code', 'check dependencies', 'analyze'."
argument-hint: "<tool_name> [context or parameters]"
model: gemini-2.5-flash
allowed-tools: read_file, shell, glob
---

# quorum-tools (Gemini)

Follow the canonical protocol at `platform/skills/consensus-tools/SKILL.md`.
References at `platform/skills/consensus-tools/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Run command | `shell` |

## Setup

Invocation:
```bash
quorum tool <tool_name> --param value ...
```

Fallback: `node platform/core/tools/tool-runner.mjs <tool_name> --param value ...`
