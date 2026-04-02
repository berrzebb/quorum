# Merge Worktree Protocol

Squash-merge the current worktree branch back into the target branch. All WIP commits become one structured commit.

## Prerequisites

Invoked by the orchestrator after:
1. Implementer's `[agree_tag]` consensus reached
2. Implementer's WIP commit completed
3. Retrospective protocol completed (`session-self-improvement-complete`)

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Report merge result, ask about cleanup |
| **Headless** | Merge, verify, report — do NOT cleanup (orchestrator decides) |

## Phase 1: Validation

1. **Verify worktree**: `git rev-parse --git-dir` must contain `/worktrees/`
2. **Verify retrospective complete**: Check `.claude/retro-marker.json` — `retro_pending` must be `false`
3. **Identify current branch**: `git branch --show-current`
4. **Resolve target branch**: Arguments or detect `main`/`master`
5. **Find original repo root**: `ORIGINAL_ROOT="$(git rev-parse --git-common-dir)/.."`
6. **Clean working tree**: `git status --porcelain` must be empty

## Phase 2: Research

1. Commit history: `git log --oneline <target>..HEAD`
2. File change summary: `git diff <target>...HEAD --stat`
3. Full diff: `git diff <target>...HEAD`
4. Read key files for significantly changed files
5. Categorize: Features, Fixes, Refactors, Tests, Docs, Chore

## Phase 2.5: Doc-Sync (Automatic)

Before generating the commit message, run doc-sync to ensure documentation reflects current code state. If fixes were made, stage the changed doc files — they become part of the squash commit.

## Phase 3: Commit Message

```
<type>(<scope>): <summary under 72 chars>

<body — what changed and why, grouped by category>

<footer — breaking changes, issue refs, co-authors>
```

Type rules: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

## Phase 4: Execute Merge

All commands use absolute paths.

1. Squash merge: `git -C "${ORIGINAL_ROOT}" merge --squash <worktree_branch>`
2. Commit with generated message
3. Verify merge commit exists: `git -C "${ORIGINAL_ROOT}" log -1 --oneline`
4. Verify no uncommitted changes remain
5. Report: branch, commits squashed, files changed, commit SHA

## Phase 5: Cleanup

Report to orchestrator with cleanup options. Do not remove worktrees autonomously.

## Emergency Rollback

If post-merge verification fails:
1. Revert: `git -C "${ORIGINAL_ROOT}" revert --no-edit <merge-sha>`
2. Verify revert
3. Run tests to confirm passing state
4. Report rollback reason

Do NOT use `git reset --hard` — revert creates an audit trail.

## Anti-Patterns

- Do NOT merge if `git status --porcelain` shows uncommitted changes
- Do NOT force-push after merge
- Do NOT delete worktree without orchestrator decision
- Do NOT merge if retrospective is pending
- Do NOT report success without verifying the squash commit exists
