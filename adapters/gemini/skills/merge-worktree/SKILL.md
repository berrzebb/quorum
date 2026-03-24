---
name: quorum-merge
description: "Squash-merge a worktree branch into target with structured commit message. Use after audit consensus and retrospective. Triggers on 'merge worktree', 'squash merge', 'finalize work'."
argument-hint: "[target-branch]"
disable-model-invocation: true
model: gemini-2.5-pro
context: fork
allowed-tools: read_file, glob, grep, shell
---

# Merge Worktree

Squash-merge the current worktree branch back into the target branch. All WIP commits become one structured commit.

## Who Runs This

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

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Search content | `grep` |
| Run command | `shell` |

## Instructions

Follow phases in order. Do NOT skip phases.

---

### Phase 1: Validation

1. **Verify worktree**: `git rev-parse --git-dir` must contain `/worktrees/`. If not, stop:
   > "This skill must be run from inside a git worktree."

2. **Verify retrospective complete**: Check `.claude/retro-marker.json` in the repo root:
   ```bash
   git -C "$(git rev-parse --git-common-dir)/.." cat-file -e HEAD:.claude/retro-marker.json 2>/dev/null || cat "$(git rev-parse --git-common-dir)/../.claude/retro-marker.json" 2>/dev/null
   ```
   If `retro_pending` is `true`, stop:
   > "Retrospective not completed. Run retrospective first, then `session-self-improvement-complete`."

3. **Identify current branch**: `git branch --show-current`

4. **Resolve target branch**:
   - If `$ARGUMENTS` provided, use as target
   - Otherwise, detect `main` or `master`

5. **Find original repo root**:
   ```bash
   ORIGINAL_ROOT="$(git rev-parse --git-common-dir)/.."
   ```

6. **Clean working tree**: `git status --porcelain` must be empty. If not, stop:
   > "Uncommitted changes found. Commit or stash first."

---

### Phase 2: Research

1. **Commit history**: `git log --oneline <target>..HEAD`
2. **File change summary**: `git diff <target>...HEAD --stat`
3. **Full diff**: `git diff <target>...HEAD` — read carefully
4. **Read key files**: For significantly changed files, use `read_file` to understand full context
5. **Categorize changes**: Features, Fixes, Refactors, Tests, Docs, Chore

---

### Phase 2.5: Doc-Sync (Automatic)

Before generating the commit message, run doc-sync to ensure documentation reflects the current code state:

1. **Spawn doc-sync** in headless mode via `spawn_agent` — it extracts facts from code and fixes mismatches in all 8 doc files.
2. **Wait for completion** — the agent outputs a Doc-Sync Report.
3. **If fixes were made**: stage the changed doc files (`git add README.md README.ko.md docs/`). These become part of the squash commit.
4. **If no fixes needed**: proceed.

This step is automatic and does not require user confirmation.

---

### Phase 3: Generate Commit Message

Structure:
```
<type>(<scope>): <summary under 72 chars>

<body — what changed and why, grouped by category>

<footer — breaking changes, issue refs, co-authors>
```

**Type rules**: `feat` (new functionality), `fix` (bug correction), `refactor` (restructuring), `test` (test-only), `docs` (doc-only), `chore` (build/CI/tooling)

**Scope**: primary module affected (e.g., `bus`, `security`, `orchestration`)

**Footer**:
```
Co-Authored-By: Gemini 2.5 Pro <noreply@google.com>
```

---

### Phase 4: Execute Merge

All commands use absolute paths or `git -C` — shell state does not persist between commands.

1. **Squash merge** (from original repo root):
   ```bash
   git -C "${ORIGINAL_ROOT}" merge --squash <worktree_branch>
   ```

2. **Commit with generated message**:
   ```bash
   git -C "${ORIGINAL_ROOT}" commit -m "<generated_message>"
   ```

3. **Verify merge commit exists**:
   ```bash
   git -C "${ORIGINAL_ROOT}" log -1 --oneline
   ```
   Must show the new squash commit. If not — merge failed, report error.

4. **Verify no uncommitted changes remain**:
   ```bash
   git -C "${ORIGINAL_ROOT}" status --porcelain
   ```
   Must be empty. If not — partial merge, report and stop.

5. **Report result**:
   ```
   ## Merge Complete
   - Branch: <worktree_branch> -> <target_branch>
   - Commits squashed: N
   - Files changed: M
   - Commit: <short_sha> <first_line>
   - Verified: commit exists, working tree clean
   ```

---

### Phase 5: Cleanup

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
