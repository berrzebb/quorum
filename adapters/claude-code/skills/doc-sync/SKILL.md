---
name: quorum:doc-sync
description: "Extract facts from code and fix documentation mismatches across 3 layers: L1 public docs (README, AGENTS, TOOLS — EN/KO), L2 RTM, L3 design docs. Use before squash commit, after version bump, or when doc numbers look wrong. Triggers on 'sync docs', 'fix docs', 'doc mismatch', 'update documentation numbers'."
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(npm test*), Bash(ls *), Bash(wc *), Bash(git diff*), Bash(git log*), Bash(git status*), Edit, Write
---

# Doc-Sync (Claude Code)

Follow the canonical protocol at `platform/skills/doc-sync/SKILL.md`.
Core protocol: `agents/knowledge/doc-sync-protocol.md`.
References at `platform/skills/doc-sync/references/`.

## Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Write file | `Write` |
| Edit file | `Edit` |
| Run command | `Bash` |
| Find files | `Glob` |
| Search content | `Grep` |
