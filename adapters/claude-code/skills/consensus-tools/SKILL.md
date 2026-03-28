---
name: quorum:tools
description: "Run any of the 20 quorum analysis tools via CLI — codebase, quality, domain checks, RTM/FVM, and audit_history. Use whenever you need code analysis or domain checks. Triggers on 'run tool', 'scan code', 'check dependencies', 'analyze'."
argument-hint: "<tool_name> [context or parameters]"
model: claude-sonnet-4-6
allowed-tools: Read, Bash(node *), Bash(git *)
---

# quorum:tools (Claude Code)

Follow the canonical protocol at `platform/skills/consensus-tools/SKILL.md`.
References at `platform/skills/consensus-tools/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Run command | `Bash` |

## Setup

Tool runner path: `${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs`

Invocation:
```bash
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs <tool_name> --param value ...
```

MCP tools are also available directly (e.g. `mcp__quorum__code_map`). Use MCP when available, fall back to CLI via `Bash`.
