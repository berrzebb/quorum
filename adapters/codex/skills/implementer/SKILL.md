---
name: quorum-implementer
description: "Headless worker — receives task + context, implements code in worktree, runs tests, submits evidence, handles audit corrections. Spawned by orchestrator for Tier 2/3 tasks."
model: codex
allowed-tools: read_file, write_file, apply_diff, shell, find_files, search
---

# Implementer (Codex)

Follow the canonical protocol at `skills/implementer/SKILL.md`.
Core protocol: `agents/knowledge/implementer-protocol.md`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |

## Tool References

For detailed parameters and examples: `skills/consensus-tools/references/`
