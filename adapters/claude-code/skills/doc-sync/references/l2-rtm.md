# L2: RTM Sync

## Prerequisites

- `{planning_dir}` must contain RTM files (e.g., `rtm-*.md`)
- If no RTM files exist → skip L2 entirely

## Verification Flow

```
1. Parse RTM via rtm_parse tool → structured rows (req_id, status, code_ref, test_ref)

2. For each row:
   a. code_ref → Glob/Grep to verify file/function exists
   b. test_ref → verify test file exists
   c. Both exist → verified candidate
   d. Code only → implemented candidate
   e. Code missing → broken candidate

3. Apply status transitions only where state change is needed
```

## Status Transition Rules

| Current | Condition | New Status |
|---------|-----------|-----------|
| `open` | code_ref exists + test_ref exists | `verified` |
| `open` | code_ref exists + no test_ref | `implemented` |
| `wip` | code_ref + test_ref exist | `verified` |
| `verified` | code_ref or test_ref deleted | `broken` |
| any | code_ref file does not exist | `broken` |

## Tool Usage

```bash
# Parse RTM
node core/tools/tool-runner.mjs rtm_parse --path {rtm_path} --json

# Verify code references
# Use Glob for file existence, Grep for function/class existence

# Merge worktree RTMs (if needed)
node core/tools/tool-runner.mjs rtm_merge --base {base_rtm} --source {worktree_rtm}
```

## Constraints

- **Do NOT execute tests** — only verify file existence
- `verified` means "code and test files exist", NOT "tests pass"
- Test pass verification is the responsibility of `/quorum:verify`
- Only modify rows where status actually needs to change
