---
name: quorum-implementer
description: "Headless worker for quorum — receives task + context, implements code in a worktree, runs tests, submits evidence, handles audit corrections via SendMessage. Spawned by the orchestrator for Tier 2/3 tasks. Also use when you need an isolated coding agent that follows the full evidence submission protocol."
model: gemini-2.5-pro
allowed-tools: read_file, write_file, edit_file, shell, glob, grep
---

# Implementer (Gemini)

Follow the canonical protocol at `platform/skills/implementer/SKILL.md`.
Core protocol: `agents/knowledge/implementer-protocol.md`.
Frontend reference: `agents/references/frontend.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `edit_file` |
| Run command | `shell` |
| Find files | `glob` |
| Search content | `grep` |

## Tool References

For detailed parameters and examples: `platform/skills/consensus-tools/references/`
