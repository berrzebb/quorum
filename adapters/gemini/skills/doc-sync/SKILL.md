---
name: quorum:doc-sync
description: "Extract facts from code and fix documentation mismatches across 3 layers: L1 public docs (README, AGENTS, TOOLS — EN/KO), L2 RTM, L3 design docs. Use before squash commit, after version bump, or when doc numbers look wrong. Triggers on 'sync docs', 'fix docs', 'doc mismatch', 'update documentation numbers', '문서 동기화'."
model: gemini-2.5-flash
allowed-tools: read_file, write_file, edit_file, shell, glob, grep
---

# Doc-Sync (Gemini)

Follow the canonical protocol at `skills/doc-sync/SKILL.md`.
Core protocol: `agents/knowledge/doc-sync-protocol.md`.
References at `skills/doc-sync/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `edit_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |
