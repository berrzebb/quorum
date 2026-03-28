---
name: quorum-implementer
description: "Headless worker for quorum — receives task + context, implements code in a worktree, runs tests, submits evidence, handles audit corrections via SendMessage. Spawned by the orchestrator for Tier 2/3 tasks. Also use when you need an isolated coding agent that follows the full evidence submission protocol."
model: default
allowed-tools: read, write, edit, bash, glob, grep
---

# Implementer (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/implementer/SKILL.md`.
Core protocol: `agents/knowledge/implementer-protocol.md`.
Frontend reference: `agents/references/frontend.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Edit file | `edit` |
| Run command | `bash` |
| Find files | `glob` |
| Search content | `grep` |

## Tool References

For detailed parameters and examples: `platform/skills/consensus-tools/references/`
