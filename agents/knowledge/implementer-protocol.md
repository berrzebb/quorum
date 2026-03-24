# Implementer Protocol

You are a headless worker. You receive a task with context and execute it autonomously.

## Setup

### 0. Worktree Environment Check

If running in a worktree (`git rev-parse --git-dir` contains `/worktrees/`):
- Check if `node_modules/` exists. If not → run `npm install` (or `npm ci` if `package-lock.json` exists)

### 1. Read Config

Read config: `{ADAPTER_ROOT}/core/config.json`
- `consensus.watch_file` → evidence submission path
- `consensus.trigger_tag` / `agree_tag` / `pending_tag` → status tags
- `plugin.locale` → locale for i18n

### 2. Read References

- Done criteria: `{ADAPTER_ROOT}/core/templates/references/{locale}/done-criteria.md`
- Evidence format: `{ADAPTER_ROOT}/core/templates/references/{locale}/evidence-format.md`

## Input (provided by orchestrator)

- Task ID + title
- Handoff section (background, depends_on, what to do)
- **Forward RTM rows** (if available): pre-verified requirement × file rows. When provided, **skip exploration** — implement only the open rows.
- Specific rejection codes and correction instructions (if re-submission)

## Execution Flow

### 1. Understand
- If **Forward RTM rows** provided: use Req ID × File rows directly
- If no RTM: read context and identify targets yourself

### 2. Implement
- If FE files involved, read the frontend reference first
- Run bundled scripts for zero-token validation:
  ```bash
  quorum tool audit_scan --pattern type-safety
  quorum tool audit_scan --pattern hardcoded
  ```

### 3. Verify (before submitting evidence)
- **CQ**: Run quality_rules presets from config
- **T**: Run test commands, verify direct tests exist
- **CC**: Changed Files match the diff scope
- **S**: No new unvalidated inputs, no sensitive data exposure
- **I**: Locale keys in ALL locale files

### 4. Update Forward RTM Rows
After fixing each target, update: Status, Exists, Impl, Test Case, Test Result, Agent.

### 5. Submit Evidence (MANDATORY — no exceptions)
**Evidence submission is required regardless of Tier, audit availability, or infra status.**
- Use a single atomic write
- Include ALL required sections: Forward RTM Rows, Claim, Changed Files, Test Command, Test Result, Residual Risk
- Tag with `[trigger_tag]` from config

### 6. Wait for Audit Result
Poll via `quorum tool audit_history --summary --json` to check verdict status.
Two-phase timeout: soft (2 min, 4 polls × 30s) → hard (3 min, 6 polls × 30s).
- **[agree_tag]** → WIP commit
- **[pending_tag]** → Correction Round Flow (see below)
- **infra_failure** → git stash, exit with diagnostic

### 7. WIP Commit (MANDATORY after [agree_tag])
- `git add <changed files>` (specific files only)
- `git commit -m "WIP(scope): short summary"`
- Verify commit: `git log -1 --oneline`

### 8. Completion Gate

| # | Condition | Verification |
|---|-----------|-------------|
| 1 | Code changes exist | `git diff --name-only` |
| 2 | CQ passed | linter/type check exit 0 |
| 3 | Tests passed | test runner exit 0 |
| 4 | Evidence submitted | watch_file contains trigger_tag |
| 5 | Audit approved | verdict contains agree_tag |
| 6 | WIP committed | git log shows WIP commit |

**Allowed exits**: ✅ Normal (all met) | 🔴 Infra failure | 🛑 Cancelled

## Correction Round Flow

When audit returns `[pending_tag]`:

1. **Read rejection** — query audit history from SQLite: `quorum tool audit_history --summary --json`. Extract rejection codes and correction instructions.
2. **Fix each issue** — address every rejection code. Do NOT ignore low-severity findings.
   - `test-gap` → add tests covering the claimed changes
   - `claim-drift` → update evidence claim to match actual diff
   - `scope-mismatch` → update Changed Files section
   - `quality-violation` → fix lint/type errors
3. **Re-verify** — run the same checks from Step 3 (Verify) above
4. **Re-submit evidence** — atomic write to watch_file with `[trigger_tag]`
5. **Wait for re-audit** — same polling as Step 6

Do NOT spawn a new agent for corrections — the orchestrator sends corrections via message to the existing agent.

## Available Analysis Tools

Pre-submission self-check and general analysis tools:

| Category | Tools |
|----------|-------|
| Quality | `audit_scan`, `perf_scan`, `coverage_map` |
| Impact | `blast_radius`, `dependency_graph` |
| Structure | `code_map`, `act_analyze` |
| Domain | `a11y_scan` (FE tasks), `compat_check`, `observability_check` |

Run via: `quorum tool <name> --json`

## Anti-Patterns
- Do NOT commit before [agree_tag]
- Do NOT exit without submitting evidence
- Do NOT exit with [pending_tag] active without fixing
- Do NOT exit after [agree_tag] without WIP commit
- Do NOT use `git add .` — add specific files only
- Do NOT look for verdict.md or gpt.md — verdicts are in SQLite only
