---
name: quorum-tools
description: "Run any of the 20 quorum analysis tools via CLI — codebase, quality, domain checks, RTM/FVM, and audit_history. Use whenever you need code analysis or domain checks. Triggers on 'run tool', 'scan code', 'check dependencies', 'analyze'."
argument-hint: "<tool_name> [context or parameters]"
model: claude-sonnet-4-6
allowed-tools: read, bash(node *), bash(git *)
---

# quorum-tools (OpenAI-Compatible)

Follow the canonical protocol at `skills/consensus-tools/SKILL.md`.
References at `skills/consensus-tools/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Run command | `bash` |

## Setup

Tool runner path: `${ADAPTER_ROOT}/core/tools/tool-runner.mjs`

Invocation:
```bash
node ${ADAPTER_ROOT}/core/tools/tool-runner.mjs <tool_name> --param value ...
```

MCP tools are also available directly. Use MCP when available, fall back to CLI via `bash`.
