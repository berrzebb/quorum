# Expected: Checkpoint Restore

## Procedure Steps

1. List available checkpoints for track "auth-refactor"
2. Identify cp-003 as the target checkpoint
3. Show what will change (Wave state diff, WB status changes)
4. Create safety checkpoint of current state (auto, labeled "Pre-restore safety")
5. Confirm with user before proceeding
6. Restore wave-state JSON from cp-003 (completedIds back to 6, clear failedIds)
7. Restore work-catalog WB statuses to checkpoint values
8. Emit checkpoint.restored event to SQLite (append-only, no deletion)
9. Show git diff between current and checkpoint gitRef (advisory only)
10. Report what was restored and suggest next steps
