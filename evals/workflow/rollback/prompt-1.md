# Rollback to Previous Checkpoint

Wave 3 of the "auth-refactor" track failed after the fixer couldn't resolve audit findings. Restore to the checkpoint taken before Wave 3 started.

## Context

- Track: auth-refactor
- Current state: Wave 3 failed, 2 WBs stuck in failed state
- Checkpoint cp-003 exists: "Pre-Wave 3" with 6/9 WBs completed
- Wave state file at `.claude/quorum/wave-state-auth-refactor.json`
