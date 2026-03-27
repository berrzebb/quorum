# Merge Worktree Eval Scenario

Squash-merge the current worktree branch back to main.

## Context

- Current branch: `track/user-auth`
- Target branch: `main`
- Working tree: clean (no uncommitted changes)
- Retro marker: `retro_pending = false` (retrospective completed)
- Commit history: 5 WIP commits on this branch
- Changed files: 8 files (auth middleware, login, tests, config)

## Task

Execute `/quorum:merge` to squash-merge this worktree branch.
