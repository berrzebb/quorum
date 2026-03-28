---
name: quorum-doc-sync
description: "Extract facts from code and fix documentation mismatches across 3 layers: L1 public docs, L2 RTM, L3 design docs. Use before squash commit or when doc numbers look wrong. Triggers on 'sync docs', 'fix docs', 'doc mismatch'."
model: codex
allowed-tools: read_file, write_file, apply_diff, shell, find_files, search
---

# Doc-Sync (Codex)

Follow the canonical protocol at `platform/skills/doc-sync/SKILL.md`.
Core protocol: `agents/knowledge/doc-sync-protocol.md`.
References at `platform/skills/doc-sync/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |
