---
name: quorum:self-checker
description: "Run pre-audit self-verification on implemented code — CQ (lint/types), T (tests), CC (changed files match claim), S (security), I (i18n). Zero LLM tokens — uses only deterministic tools. Catches issues before expensive audit round-trips. Triggers on 'self check', 'pre-audit', 'verify before submit', '자가 검증', '제출 전 확인', 'oracle check'."
argument-hint: "<changed files or 'auto' to detect from git diff>"
context: fork
mergeResult: false
permissionMode: plan
memory: none
skills:
  - consensus-tools
tools:
  - read
  - glob
  - grep
  - bash
hooks: {}
---

# Self-Checker

Pre-audit verification gate using deterministic tools only. Catches issues that would cost a full audit round-trip to discover. This skill exists because every failed audit wastes LLM tokens — catching problems locally is free.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | — | — |
| 2. Planning | — | — |
| 3. Design | — | — |
| 4. Implementation | Runs after implementer completes | input |
| 5. **Verification** | **CQ/T/CC/S/I checks via deterministic tools** | **✅ primary** |
| 6. Audit | Results feed into evidence submission | downstream |
| 7. Convergence | Re-run per convergence iteration | secondary |
| 8. Retrospective | — | — |

## Model Selection

This skill runs on **haiku** — no judgment is needed, only tool execution and result reporting. The tools do the thinking; the model formats the output.

## When to Use

- After implementing code, before submitting evidence
- When the orchestrator wants a pre-flight check before spawning an auditor
- When the implementer wants to verify quality without incurring audit cost
- Can be invoked standalone on any set of changed files

## Input

- **Changed files**: explicit list or auto-detected from `git diff --name-only`
- **Task context** (optional): WB-ID, target files from orchestrator

If no files specified, auto-detect from git:
```
git diff --name-only HEAD
```

## 5-Point Verification

### CQ — Code Quality

Run quality checks appropriate to the detected language:

```
quorum tool audit_scan --path <changed_files> --json
```

Language-specific checks are resolved from `languages/{lang}/spec.mjs` → `verify.CQ` and `verify.T` fields. Detect the language from changed file extensions, then read the matching spec's `verify.CQ.cmd`. Only run if marker files from `verify.CQ.detect` exist in the project root.

Pass criteria: exit code 0, no new violations compared to baseline.

### T — Tests

Run test suite and verify test coverage of changed code:

```
quorum tool coverage_map --path <changed_files> --json
```

Test command is resolved from `languages/{lang}/spec.mjs` → `verify.TEST.cmd`. Only run if marker files from `verify.TEST.detect` exist. The language registry supports: TypeScript/JS, Go, Python, Rust, Java — and any future language added to `languages/`.

Pass criteria: all tests pass, changed functions have at least one test.

### CC — Changed Files

Verify the actual diff matches the intended scope:

```
git diff --name-only HEAD
```

Compare against target files from task. Flag:
- **Missing**: target files with no changes (incomplete implementation)
- **Extra**: changed files not in target list (scope creep)

Pass criteria: actual changed files match or are a subset of target files.

### S — Security

Check for security regressions:

```
quorum tool audit_scan --pattern security --path <changed_files> --json
```

Flag:
- New unvalidated user inputs
- Exposed secrets or credentials
- SQL injection / XSS patterns
- Hardcoded passwords or tokens

Pass criteria: no new security findings in changed code.

### I — i18n (Internationalization)

Check locale key completeness:

```
quorum tool i18n_validate --path <changed_files> --json
```

Flag:
- Hardcoded user-facing strings (not in locale files)
- New locale keys missing from any locale file

Pass criteria: all user-facing strings use locale keys, present in all locale files.

## Oracle Loop Integration

After 5-point verification, run the aggregate oracle check:

```
quorum tool blast_radius --path <changed_files> --json
```

If blast radius ratio > 0.1, flag as high-impact change requiring careful review.

## Output

Structured verification report:

```
Self-Check Report
━━━━━━━━━━━━━━━━━

| Check | Status | Details |
|-------|--------|---------|
| CQ    | ✅ PASS | 0 violations |
| T     | ✅ PASS | 12/12 tests, 3 functions covered |
| CC    | ⚠️ WARN | 1 extra file (utils.ts) |
| S     | ✅ PASS | 0 security findings |
| I     | ❌ FAIL | 2 hardcoded strings in LoginForm.tsx |

Overall: FAIL (1 blocking, 1 warning)
Blocking issues must be fixed before evidence submission.
```

## Pass/Fail Logic

- **PASS**: All 5 checks pass → safe to submit evidence
- **WARN**: Non-blocking issues found (extra files, low-severity findings) → submit with notes
- **FAIL**: Blocking issues found (test failures, security, i18n) → fix before submission

## Rules

- This skill is **read-only** in terms of code — it runs tools and reports, never fixes
- All checks are deterministic — no LLM judgment involved
- Results feed into evidence submission (the implementer includes the report in evidence)
- A FAIL result does NOT block submission — it advises. The implementer decides.

## Anti-Patterns

- Do NOT fix issues — only report them (fixer handles fixes)
- Do NOT skip any of the 5 checks — run all, report all
- Do NOT use LLM inference for judgment — tools provide pass/fail
- Do NOT run on uncommitted files not in the changed set
