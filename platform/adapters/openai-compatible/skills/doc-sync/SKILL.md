---
name: quorum-doc-sync
description: "Extract facts from code and fix documentation mismatches across 3 layers: L1 public docs (README, AGENTS, TOOLS — EN/KO), L2 RTM, L3 design docs. Use before squash commit, after version bump, or when doc numbers look wrong. Triggers on 'sync docs', 'fix docs', 'doc mismatch', 'update documentation numbers'."
model: claude-sonnet-4-6
allowed-tools: read, grep, glob, bash(node *), bash(npm test*), bash(ls *), bash(wc *), bash(git diff*), bash(git log*), bash(git status*), edit, write
---

# Doc-Sync (OpenAI-Compatible)

Follow the canonical protocol at `platform/skills/doc-sync/SKILL.md`.
Core protocol: `agents/knowledge/doc-sync-protocol.md`.
References at `platform/skills/doc-sync/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read` |
| Write file | `write` |
| Edit file | `edit` |
| Run command | `bash` |
| Find files | `glob` |
| Search content | `grep` |
