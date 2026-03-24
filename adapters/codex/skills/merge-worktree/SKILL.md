---
name: quorum-merge
description: "Squash-merge a worktree branch into target with structured commit message. Use after audit consensus and retrospective completion. Triggers on 'merge worktree', 'squash merge', 'finalize work'."
argument-hint: "[target-branch]"
disable-model-invocation: true
model: codex
context: fork
allowed-tools: read_file, find_files, search, shell
---

# Merge Worktree

Squash-merge current worktree branch into target. All WIP commits become one structured commit.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |
| Spawn agent | `create_agent` |

## Prerequisites

Invoked after: (1) `[agree_tag]` consensus, (2) WIP commit done, (3) retrospective completed.

**Interactive**: report result, ask about cleanup. **Headless**: merge, verify, report — do NOT cleanup.

### Phase 1: Validation

1. `git rev-parse --git-dir` must contain `/worktrees/`
2. `.claude/retro-marker.json` — stop if `retro_pending: true`
3. Branch: `git branch --show-current`
4. Target: `$ARGUMENTS` or detect `main`/`master`
5. Root: `ORIGINAL_ROOT="$(git rev-parse --git-common-dir)/.."`
6. `git status --porcelain` must be empty

### Phase 2: Research

1. `git log --oneline <target>..HEAD`
2. `git diff <target>...HEAD --stat`
3. `git diff <target>...HEAD` — read carefully
4. Categorize: Features, Fixes, Refactors, Tests, Docs, Chore

### Phase 2.5: Doc-Sync

Spawn doc-sync agent (headless) per `agents/knowledge/doc-sync-protocol.md`. If fixes made, `git add README.md README.ko.md docs/`. Automatic, no confirmation needed.

### Phase 3: Commit Message

```
<type>(<scope>): <summary under 72 chars>

<body — grouped by category, explain WHY>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

### Phase 4: Execute

```bash
git -C "${ORIGINAL_ROOT}" merge --squash <worktree_branch>
git -C "${ORIGINAL_ROOT}" commit -m "<message>"
git -C "${ORIGINAL_ROOT}" log -1 --oneline        # verify
git -C "${ORIGINAL_ROOT}" status --porcelain       # clean check
```

Report: branch, commits squashed, files changed, SHA, verification.

### Phase 5: Cleanup

Report options — do not remove worktrees autonomously.

## Emergency Rollback

`git -C "${ORIGINAL_ROOT}" revert --no-edit <merge-sha>`. Verify, run tests, set task to `correcting`. Do NOT use `git reset --hard`.

## Exceptions

- Do NOT merge with uncommitted changes
- Do NOT force-push after merge
- Do NOT delete worktree without orchestrator decision
- Do NOT merge if retro pending
- Do NOT report success without verifying commit in git log
