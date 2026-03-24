# L3: Design Document Sync

## Prerequisites

- `{planning_dir}` directory must exist
- At least one of: PRD.md, work-breakdown.md, work-catalog.md
- If none exist → skip L3 entirely

## Work Breakdown Status Update

### Flow

```
For each WB item (### {TRACK}-N):
  1. Extract "First touch files" list
  2. git diff {base}..HEAD --name-only → check if those files were changed
  3. Check test file existence (from "Done" criteria)
  4. Determine status:
     - All first-touch files changed + test files exist → done
     - Some files changed → in-progress
     - No files changed → keep current status
```

### Status Transition Rules

| Current | Condition | New Status |
|---------|-----------|-----------|
| `open` / `blocked` | All files changed + tests exist | `done` |
| `open` / `blocked` | Some files changed | `in-progress` |
| `in-progress` | All files changed + tests exist | `done` |
| `done` | — | No change (already complete) |
| `blocked` | Dependency WB became `done` | `open` (blocker resolved) |

### Important

- ALL first-touch files must be changed to mark `done` — partial is `in-progress`
- If test files are specified but don't exist → `in-progress` (not `done`)
- Do NOT run tests — only check file existence

## Work Catalog Sync

When WB status changes, update `work-catalog.md`:

1. **All Items table**: Update the Status column for changed WB rows
2. **Summary table**: Recalculate Done / In Progress / Blocked / Remaining counts
3. **Filter sections**: Regenerate By Status and By Risk tables

Summary numbers are counted from the All Items rows directly — never trust existing numbers.

## PRD Track Map Sync

Aggregate WB status within each track → update Track Map Status:

| Condition | Track Status |
|-----------|-------------|
| All WBs are `done` | `done` |
| Any WB is `in-progress` | `in-progress` |
| All WBs are `open` / `blocked` | `planned` |
| Deprecated track | No change |

## Tool Usage

```bash
# Diff against base branch
git diff {base}..HEAD --name-only

# File existence checks
# Use Glob for first-touch files and test files

# Code analysis (optional, for deeper verification)
node core/tools/tool-runner.mjs code_map --path {track_dir} --json
node core/tools/tool-runner.mjs coverage_map --path {track_dir} --json
```
