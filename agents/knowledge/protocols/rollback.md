# Rollback Protocol

Create and manage checkpoints for safe state recovery during Wave execution and planning.

## State Covered

| State Type | Source | What's Saved |
|------------|--------|-------------|
| Wave state | `.claude/quorum/wave-state-{track}.json` | completedIds, failedIds, lastCompletedWave |
| SQLite events | EventStore | Event count at checkpoint time |
| Track progress | `work-catalog.md` | WB statuses |
| Planning docs | `{planning_dir}/{track}/` | File snapshot |

## Actions

### list — Show available checkpoints

### create — Create a manual checkpoint

Storage: `.claude/quorum/checkpoints/{track}/{checkpoint-id}.json`

Auto-checkpoints are also created: before each Wave, before audit submission, before merge.

### restore — Restore to a checkpoint

1. Auto-create safety checkpoint of current state
2. Confirm (interactive mode)
3. Overwrite wave-state JSON
4. Restore WB statuses in work catalog
5. Show git diff if `gitRef` present (does NOT auto-checkout)
6. Report what was restored

Restore does NOT: delete SQLite events (append-only), auto-checkout git, remove files created after checkpoint.

### diff — Compare current state against a checkpoint

## Rules

- Always create safety checkpoint before restoring
- Never delete events from SQLite — add `checkpoint.restored` event
- Git operations are advisory, not automatic
- Auto-checkpoints have `type: "auto"`, manual ones `type: "manual"`
