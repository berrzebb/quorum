# Expected Merge Procedure

## Phase 1: Validation
1. Verify worktree: git rev-parse --git-dir must contain /worktrees/
2. Verify retrospective complete: check retro-marker.json, retro_pending must be false
3. Identify current branch: track/user-auth
4. Resolve target branch: main
5. Find original repo root via git rev-parse --git-common-dir
6. Verify clean working tree: git status --porcelain must be empty

## Phase 2: Research
7. Read commit history: git log --oneline main..HEAD (5 WIP commits)
8. Read file change summary: git diff main...HEAD --stat
9. Read full diff: git diff main...HEAD
10. Read key changed files to understand full context

## Phase 2.5: Doc-Sync
11. Run doc-sync protocol before creating squash commit
12. Extract facts from code (hook counts, tool counts, test counts)
13. Fix numeric mismatches in documentation files
14. Fix section parity gaps across EN/KO docs

## Phase 3: Squash Merge
15. Switch to original repo: cd to original root
16. Execute squash merge: git merge --squash track/user-auth
17. Create structured commit message with type(scope): subject format
18. Include body with summary of changes, changed file list
19. Include Co-Authored-By if applicable

## Phase 4: Verify
20. Run git log to confirm squash commit exists on main
21. Verify all changes present in single commit
22. Report merge result (commit hash, files changed, insertions, deletions)
23. In headless mode: do NOT ask about worktree cleanup
