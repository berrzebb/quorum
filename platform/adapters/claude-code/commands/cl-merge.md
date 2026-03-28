---
name: cl-merge
description: "Shortcut for /quorum:merge — squash-merge worktree branch"
arguments:
  - name: target_branch
    description: "Target branch (default: main)"
    required: false
---

Invoke the merge skill: `/quorum:merge {{ target_branch }}`
