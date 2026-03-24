---
name: quorum:merge
description: "Squash-merge a worktree branch into target with structured commit message. Use after audit consensus and retrospective."
---

# Merge Worktree

Squash-merge the current worktree branch back into the target branch. All WIP commits become one structured commit.

## Prerequisites

This skill is invoked by the **orchestrator** after:
1. Implementer's `[agree_tag]` consensus reached
2. Implementer's WIP commit completed
3. **Retrospective protocol completed** (session-gate released via `session-self-improvement-complete`)

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Report merge result, ask about cleanup |
| **Headless** | Merge, verify, report result — do NOT cleanup (orchestrator decides) |

In headless mode, do NOT ask "keep worktree or remove?" — report the result and exit.

## Phase 1: Validation

1. **Verify worktree**: `git rev-parse --git-dir` must contain `/worktrees/`. If not, stop.
2. **Verify retrospective complete**: Check `.claude/retro-marker.json` in the repo root. If `retro_pending` is `true`, stop.
3. **Identify current branch**: `git branch --show-current`
4. **Resolve target branch**: Use arguments if provided, otherwise detect `main` or `master`.
5. **Find original repo root**: `ORIGINAL_ROOT="$(git rev-parse --git-common-dir)/.."`
6. **Clean working tree**: `git status --porcelain` must be empty. If not, stop.

## Phase 2: Research

1. **Commit history**: `git log --oneline <target>..HEAD`
2. **File change summary**: `git diff <target>...HEAD --stat`
3. **Full diff**: `git diff <target>...HEAD` — read carefully
4. **Read key files**: For significantly changed files, read to understand full context
5. **Categorize changes**: Features, Fixes, Refactors, Tests, Docs, Chore

## Phase 2.5: Doc-Sync (Automatic)

Before generating the commit message, run doc-sync to ensure documentation reflects the current code state:

1. **Invoke doc-sync** in headless mode — it extracts facts from code and fixes mismatches in all 8 doc files.
2. **Wait for completion** — the agent outputs a Doc-Sync Report.
3. **If fixes were made**: stage the changed doc files. These become part of the squash commit.
4. **If no fixes needed**: proceed.

This step is automatic and does not require user confirmation.

## Phase 3: Commit Message

Structure:
```
<type>(<scope>): <summary under 72 chars>

<body — what changed and why, grouped by category>

<footer — breaking changes, issue refs, co-authors>
```

**Type rules**: `feat` (new functionality), `fix` (bug correction), `refactor` (restructuring), `test` (test-only), `docs` (doc-only), `chore` (build/CI/tooling)

**Scope**: primary module affected (e.g., `bus`, `security`, `orchestration`)

## Phase 4: Execute Merge

All commands use absolute paths — shell state does not persist between commands.

1. **Squash merge** (from original repo root): `git -C "${ORIGINAL_ROOT}" merge --squash <worktree_branch>`
2. **Commit** with generated message
3. **Verify merge commit exists**: `git -C "${ORIGINAL_ROOT}" log -1 --oneline`
4. **Verify no uncommitted changes remain**: `git -C "${ORIGINAL_ROOT}" status --porcelain`
5. **Report result**: branch, commits squashed, files changed, commit SHA, verification status

## Phase 5: Cleanup

Report to orchestrator with cleanup options. The orchestrator decides — this skill does not remove worktrees autonomously.

## Emergency Rollback

If post-merge verification fails (tests break, build fails):

1. **Revert the merge commit**: `git -C "${ORIGINAL_ROOT}" revert --no-edit <merge-sha>`
2. **Verify revert**: `git -C "${ORIGINAL_ROOT}" diff HEAD~1..HEAD --stat`
3. **Run tests**: confirm the revert restores passing state
4. **Report**: rollback reason, status, task returns to `correcting`

Do NOT use `git reset --hard` — revert creates an audit trail.

## Exceptions

- Do NOT merge if `git status --porcelain` shows uncommitted changes
- Do NOT force-push after merge
- Do NOT delete the worktree without orchestrator decision
- Do NOT merge if retrospective is pending (`retro_pending: true`)
- Do NOT report success without verifying the squash commit exists in git log
