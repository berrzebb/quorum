---
name: quorum:verify
description: "Run all 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) with 20 analysis tools and 5-language registry. Use after implementing code, before submitting evidence."
---

# Implementation Verification

Run all done-criteria checks before evidence submission.

## 8-Category Structure

| # | Category | Key Checks | Tools |
|---|----------|-----------|-------|
| 1 | Code Quality (CQ) | Per-file + project-wide checks, type-safety, pattern violations | `audit_scan`, `perf_scan`, `compat_check`, `observability_check` |
| 2 | Test (T) | Execute evidence test commands, verify direct tests exist | test runner |
| 3 | Claim-Code (CC) | Diff scope vs Changed Files match | `blast_radius`, git diff |
| 4 | Cross-Layer (CL) | BE->FE contracts, consumer existence, import cycles | `dependency_graph`, `code_map` |
| 5 | Security (S) | Input validation, auth guards, hardcoded secrets | `audit_scan --pattern hardcoded`, `license_scan` |
| 6 | i18n (I) | Locale keys in ALL locale files, no hardcoded strings | `i18n_validate` |
| 7 | Frontend (FV) | Page loads, DOM elements, console errors, build | `a11y_scan`, `doc_coverage` |
| 8 | Coverage (CV) | stmt >= 85%, branch >= 75% per changed file | `coverage_map` |

## Language-Aware Checks

The verification process uses the **language registry** (`languages/{lang}/spec.{domain}.mjs`) for language-specific quality rules:

| Language | Quality Domains Available |
|----------|-------------------------|
| TypeScript | perf, a11y, compat, observability, doc |
| Go | perf, security, compat, observability, doc |
| Python | perf, security, compat, observability, doc |
| Rust | perf, security, compat, observability, doc |
| Java | perf, security, compat, observability, doc |

Language is auto-detected from file extensions. Domain scans apply language-specific patterns from the corresponding fragment.

## Workflow

### Step 1: Gather Context

1. Read config — extract `consensus.trigger_tag`, `consensus.watch_file`
2. Read watch file — find section with `trigger_tag`
3. Parse: Claim, Changed Files, Test Command, Test Result, Residual Risk
4. Extract changed file list
5. Detect project languages (auto via registry)

No trigger_tag section found — output "No evidence to verify" and stop.

### Step 2: Code Quality (CQ)

```
quorum tool audit_scan --pattern type-safety
quorum tool perf_scan --path <changed-dir>
quorum tool compat_check --path <changed-dir>
quorum tool observability_check --path <changed-dir>
```

### Step 3: Test (T)

Execute test commands from evidence. Verify all referenced tests pass, direct test files exist for changed modules, no regressions.

### Step 4: Claim-Code (CC)

```
quorum tool blast_radius --path . --changed "<changed-files>"
```

Compare `git diff --name-only` against the Changed Files section. Flag undocumented changes and phantom claims.

### Step 5: Cross-Layer (CL)

```
quorum tool dependency_graph --path <changed-dir>
quorum tool code_map --path <changed-dir>
```

If changes span layers, verify contract consistency. Skip if single-layer change (mark N/A with reason).

### Step 6: Security (S)

```
quorum tool audit_scan --pattern hardcoded
quorum tool license_scan --path .
```

### Step 7: i18n (I)

```
quorum tool i18n_validate --path <changed-dir>
```

Skip if no i18n changes (mark N/A).

### Step 8: Frontend (FV) — if applicable

```
quorum tool a11y_scan --path <changed-dir>
quorum tool doc_coverage --path <changed-dir>
```

Skip if no frontend changes (mark SKIP with reason).

### Step 9: Coverage (CV)

```
quorum tool coverage_map --path <changed-dir>
```

Thresholds: stmt >= 85%, branch >= 75% per changed file.

### Step 10: Verification Report

```markdown
## Verification Report

| # | Category | Status | Details |
|---|----------|--------|---------|
| 1 | Code Quality (CQ) | PASS / X issues | ... |
| 2 | Test (T) | PASS / X issues | ... |
| 3 | Claim-Code (CC) | PASS / X issues | ... |
| 4 | Cross-Layer (CL) | PASS / N/A | ... |
| 5 | Security (S) | PASS / X issues | ... |
| 6 | i18n (I) | PASS / X issues | ... |
| 7 | Frontend (FV) | PASS / SKIP | ... |
| 8 | Coverage (CV) | PASS / X issues | ... |

**Total: X/8 passed, Y issues found**
**Languages detected: TypeScript, Go**
**Domain scans run: perf, compat, observability, a11y**
```

## Completeness Rule

**Every category row (1-8) must have a status:**

| Status | When |
|--------|------|
| PASS | Check ran and passed |
| FAIL (N issues) | Check ran and found problems |
| SKIP | Not applicable — **must include reason** |
| N/A | Cannot be evaluated — **must include reason** |

A report with any blank status cell is incomplete. Fill all 8 rows before outputting.

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Run checks, present report, suggest fixes |
| **Headless** | Run checks, output report, exit with status code (0 = all pass, 1 = failures) |

In headless mode, do NOT ask "should I fix this?" — output the report and exit.
