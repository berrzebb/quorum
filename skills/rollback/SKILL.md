---
name: quorum:rollback
description: "Manage state recovery through checkpoints. List, create, and restore checkpoints for Wave execution, track progress, and planning state. Provides structural safety net for quorum workflows. Triggers on 'rollback', 'restore', 'checkpoint', 'undo', 'recover', '롤백', '복구', '체크포인트', '되돌리기'."
argument-hint: "<action: list|create|restore> [checkpoint-id]"
context: main
mergeResult: false
permissionMode: acceptEdits
memory: project
skills: []
tools:
  - read
  - write
  - glob
  - bash
hooks: {}
---

# Rollback

Create and manage checkpoints for safe state recovery. When something goes wrong during Wave execution or planning, rollback to a known-good state instead of starting over.

## Why This Matters

Wave execution modifies code, generates events, and updates SQLite state. Without checkpoints, a failed Wave means manual cleanup. Rollback provides structural safety — mistakes are recoverable.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | — | — |
| 2. Planning | Checkpoint before plan changes | optional |
| 3. Design | — | — |
| 4. **Implementation** | **Auto-checkpoint before each Wave** | **✅ primary** |
| 5. Verification | — | — |
| 6. **Audit** | **Auto-checkpoint before audit submission** | **✅ primary** |
| 7. **Convergence** | **Restore on score regression** | **✅ primary** |
| 8. Retrospective | — | — |

Active primarily during execution phases where state changes are risky.

## State Covered

| State Type | Source | What's Saved |
|------------|--------|-------------|
| **Wave state** | `.claude/quorum/wave-state-{track}.json` | completedIds, failedIds, lastCompletedWave |
| **SQLite events** | EventStore | Event count at checkpoint time |
| **Track progress** | `work-catalog.md` | WB statuses (pending/in-progress/done) |
| **Planning docs** | `{planning_dir}/{track}/` | File snapshot (git stash-like) |

## Actions

### `list`

Show available checkpoints:

```
/quorum:rollback list
```

Output:
```
Checkpoints for track "auth-refactor":
  cp-001  2026-03-28 14:30  Wave 2 complete (6/9 WBs done)  [auto]
  cp-002  2026-03-28 15:45  Pre-audit snapshot               [manual]
  cp-003  2026-03-28 16:20  Wave 3 attempt 1                 [auto]
```

### `create`

Create a manual checkpoint:

```
/quorum:rollback create --label "before risky refactor"
```

Checkpoints are also created automatically:
- Before each Wave starts
- Before audit submission
- Before `quorum merge`

Storage: `.claude/quorum/checkpoints/{track}/{checkpoint-id}.json`

```json
{
  "id": "cp-002",
  "track": "auth-refactor",
  "label": "Pre-audit snapshot",
  "timestamp": "2026-03-28T15:45:00Z",
  "type": "manual",
  "waveState": { "completedIds": ["WB-1","WB-2","WB-3"], "failedIds": [], "lastCompletedWave": 1 },
  "eventCount": 247,
  "workCatalogSnapshot": "...",
  "gitRef": "abc1234"
}
```

### `restore`

Restore to a checkpoint:

```
/quorum:rollback restore cp-002
```

Restore sequence:
1. **Safety checkpoint** — auto-create a checkpoint of current state before restoring
2. **Confirm** — show what will change (interactive mode)
3. **Wave state** — overwrite wave-state JSON with checkpoint version
4. **Work catalog** — restore WB statuses to checkpoint values
5. **Git state** — if `gitRef` is present, show the diff and suggest `git checkout` (does NOT auto-checkout)
6. **Report** — show what was restored

Restore does NOT:
- Delete SQLite events (events are append-only; rollback adds a `checkpoint.restored` event)
- Auto-checkout git (shows diff, user decides)
- Remove files created after the checkpoint (shows list, user decides)

### `diff`

Compare current state against a checkpoint:

```
/quorum:rollback diff cp-002
```

Shows what changed since the checkpoint without restoring.

## Rules

- Always create a safety checkpoint before restoring — makes restore reversible
- Never delete events from SQLite — add a `checkpoint.restored` event instead
- Git operations are advisory, not automatic — show diff, let user decide
- Checkpoint files are plain JSON — human-readable and manually editable
- Auto-checkpoints have `type: "auto"`, manual ones have `type: "manual"`

## Anti-Patterns

- Do NOT restore without confirmation in interactive mode
- Do NOT modify SQLite event history — events are immutable
- Do NOT auto-delete files — only show what was created after the checkpoint
- Do NOT create checkpoints during restore (except the safety checkpoint)
