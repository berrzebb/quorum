---
name: quorum:verify
description: "Run all 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) with 20 analysis tools and 5-language registry. Produces a pass/fail verification report. Use after implementing code, before submitting evidence. Triggers on 'verify', 'check my code', 'run done-criteria', 'am I ready to submit', '검증', '구현 확인'. Do NOT use for audit status — use quorum:status instead."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV, CV]"
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(npx *), Bash(node *), Bash(python *), Bash(cargo *), Bash(go *), Bash(ruff *), Bash(git diff *), Bash(git status *), Bash(cat *), Bash(ls *)
---

# Implementation Verification

Run all done-criteria checks before evidence submission. Criteria from `${CLAUDE_PLUGIN_ROOT}/core/templates/references/${locale}/done-criteria.md`.

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Run checks → present report → suggest fixes |
| **Headless** | Run checks → output report → exit with status code (0 = all pass, 1 = failures) |

In headless mode, do NOT ask "should I fix this?" — output the report and exit. The caller (implementer agent) reads the report and decides.

## Quick Reference

| # | Category | Key Checks | Tools |
|---|----------|-----------|-------|
| 1 | Code Quality (CQ) | Per-file + project-wide checks, type-safety, pattern violations | `audit_scan`, `perf_scan`, `compat_check`, `observability_check` |
| 2 | Test (T) | Execute evidence test commands, verify direct tests exist | Bash (test runner) |
| 3 | Claim-Code (CC) | Diff scope vs Changed Files match | `blast_radius`, git diff |
| 4 | Cross-Layer (CL) | BE→FE contracts, consumer existence, import cycles | `dependency_graph`, `code_map` |
| 5 | Security (S) | Input validation, auth guards, hardcoded secrets | `audit_scan --pattern hardcoded`, `license_scan` |
| 6 | i18n (I) | Locale keys in ALL locale files, no hardcoded strings | `i18n_validate` |
| 7 | Frontend (FV) | Page loads, DOM elements, console errors, build | `a11y_scan`, Browser (if FE) |
| 8 | Coverage (CV) | stmt ≥ 85%, branch ≥ 75% per changed file | `coverage_map` |

## Language-Aware Checks

Domain scans are **language-aware** — auto-detect project languages and apply language-specific quality rules from `languages/{lang}/spec.{domain}.mjs` fragments. Supports TypeScript, Go, Python, Rust, Java.

For the full coverage matrix and pattern format, read the language reference: `${CLAUDE_PLUGIN_ROOT}/skills/consensus-tools/references/languages.md`

## Workflow

### Step 1: Gather Context

1. Read config → extract `consensus.trigger_tag`, `consensus.watch_file`
2. Read watch file → find section with `trigger_tag`
3. Parse: Claim, Changed Files, Test Command, Test Result, Residual Risk
4. Extract changed file list
5. Detect project languages (auto via registry)

No trigger_tag section → "No evidence to verify" → stop.

### Step 2: Code Quality (CQ)

```bash
# Type-safety and pattern scan
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_scan --pattern type-safety --json

# Performance patterns (hybrid: regex + AST)
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs perf_scan --path <changed-dir> --json

# API compatibility
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs compat_check --path <changed-dir> --json

# Observability (missing logging/metrics)
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs observability_check --path <changed-dir> --json
```

### Step 3: Test (T)

Execute the test command from the evidence package. Verify actual output matches claimed result.

### Step 4: Claim-Code (CC)

```bash
# Blast radius of changed files — verify claim scope matches actual impact
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs blast_radius --path . --changed "<changed-files>" --json
```

Compare `git diff --name-only` against the Changed Files in evidence. Flag any discrepancy.

### Step 5: Cross-Layer (CL)

```bash
# Dependency graph — check for import cycles, cross-layer dependencies
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs dependency_graph --path <changed-dir> --json

# Symbol map — verify exports consumed by other layers
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs code_map --path <changed-dir> --json
```

### Step 6: Security (S)

```bash
# Hardcoded values (secrets, URLs, credentials)
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_scan --pattern hardcoded --json

# License compliance
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs license_scan --path . --json
```

### Step 7: i18n (I)

```bash
# Hardcoded strings, missing locale keys
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs i18n_validate --path <changed-dir> --json
```

### Step 8: Frontend (FV) — if applicable

```bash
# Accessibility scan (JSX/TSX files)
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs a11y_scan --path <changed-dir> --json

# Doc coverage for component documentation
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs doc_coverage --path <changed-dir> --json
```

FE detection: check if changed files include `.tsx`, `.jsx`, or if `package.json` has React/Vue/Angular.

### Step 9: Coverage (CV)

```bash
# Per-file coverage percentages
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs coverage_map --path <changed-dir> --json
```

Thresholds: stmt ≥ 85%, branch ≥ 75% per changed file.

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

If all pass → "Ready for evidence submission."
If any fail → list issues with fix recommendations.

## Completeness Rule

**Every category row (1-8) must have a status:**

| Status | When |
|--------|------|
| PASS | Check ran and passed |
| FAIL (N issues) | Check ran and found problems |
| SKIP | Not applicable — **must include reason** |
| N/A | Cannot be evaluated — **must include reason** |

A report with any blank status cell is incomplete. Fill all 8 rows before outputting.
