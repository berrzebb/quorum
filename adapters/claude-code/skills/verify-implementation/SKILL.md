---
name: quorum:verify
description: "Run all 8 done-criteria checks (CQ/T/CC/CL/S/I/FV/CV) with 20 analysis tools and 5-language registry. Use after implementing code, before submitting evidence. Triggers on 'verify', 'check my code', '검증', '구현 확인'."
argument-hint: "[optional: specific category - CQ, T, CC, CL, S, I, FV, CV]"
model: claude-sonnet-4-6
allowed-tools: Read, Grep, Glob, Bash(npx *), Bash(node *), Bash(python *), Bash(cargo *), Bash(go *), Bash(ruff *), Bash(git diff *), Bash(git status *), Bash(cat *), Bash(ls *)
---

# Implementation Verification

Run all done-criteria checks before evidence submission.

## Execution Context

| Context | Behavior |
|---------|----------|
| **Interactive** | Run checks -> present report -> suggest fixes |
| **Headless** | Run checks -> output report -> exit with status code (0 = all pass, 1 = failures) |

In headless mode, do NOT ask "should I fix this?" — output the report and exit. The caller (implementer agent) reads the report and decides.

## Claude Code Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `Read` |
| Find files | `Glob` |
| Search content | `Grep` |
| Run command | `Bash` |

## Tool References

For detailed parameters and examples for each tool, see: `skills/consensus-tools/references/`

## Quick Reference — 20 Tools Mapped to 8 Categories

| # | Category | Key Checks | Tools |
|---|----------|-----------|-------|
| 1 | Code Quality (CQ) | Per-file + project-wide checks, type-safety, pattern violations | `audit_scan`, `perf_scan`, `compat_check`, `observability_check` |
| 2 | Test (T) | Execute evidence test commands, verify direct tests exist | Bash (test runner) |
| 3 | Claim-Code (CC) | Diff scope vs Changed Files match | `blast_radius`, git diff |
| 4 | Cross-Layer (CL) | BE->FE contracts, consumer existence, import cycles | `dependency_graph`, `code_map` |
| 5 | Security (S) | Input validation, auth guards, hardcoded secrets | `audit_scan --pattern hardcoded`, `license_scan` |
| 6 | i18n (I) | Locale keys in ALL locale files, no hardcoded strings | `i18n_validate` |
| 7 | Frontend (FV) | Page loads, DOM elements, console errors, build | `a11y_scan`, `doc_coverage` |
| 8 | Coverage (CV) | stmt >= 85%, branch >= 75% per changed file | `coverage_map` |

### Full Tool Inventory (20 tools)

| Group | Tools |
|-------|-------|
| Codebase | `code_map`, `dependency_graph`, `blast_radius`, `audit_scan`, `coverage_map`, `act_analyze` |
| Domain scans | `perf_scan`, `a11y_scan`, `compat_check`, `i18n_validate`, `license_scan`, `infra_scan`, `observability_check`, `doc_coverage` |
| RTM | `rtm_parse`, `rtm_merge` |
| FVM | `fvm_generate`, `fvm_validate` |
| Audit | `audit_history` |
| Guide | `ai_guide` |

All tools: `quorum tool <tool_name> --json`

## Language-Aware Checks

The verification process uses the **language registry** (`languages/{lang}/spec.{domain}.mjs`) for language-specific quality rules:

| Language | Quality Domains Available |
|----------|-------------------------|
| TypeScript | perf, a11y, compat, observability, doc |
| Go | perf, security, compat, observability, doc |
| Python | perf, security, compat, observability, doc |
| Rust | perf, security, compat, observability, doc |
| Java | perf, security, compat, observability, doc |

Language is auto-detected from file extensions. Domain scans apply language-specific patterns from the corresponding `spec.{domain}.mjs` fragment.

## Workflow

### Step 1: Gather Context

1. Read config via `Read` at `.quorum/config.json` — extract `consensus.trigger_tag`, `consensus.watch_file`
2. Read watch file — find section with `trigger_tag`
3. Parse: Claim, Changed Files, Test Command, Test Result, Residual Risk
4. Extract changed file list
5. Detect project languages (auto via registry)

No trigger_tag section found — output "No evidence to verify" and stop.

### Step 2: Code Quality (CQ)

```bash
# Type-safety and pattern scan
quorum tool audit_scan --pattern type-safety

# Performance patterns (hybrid: regex + AST for TypeScript)
quorum tool perf_scan --path <changed-dir>

# API compatibility
quorum tool compat_check --path <changed-dir>

# Observability (missing logging/metrics)
quorum tool observability_check --path <changed-dir>
```

Check for lint errors, type errors, pattern violations, unused variables.

### Step 3: Test (T)

Execute the test commands from evidence. Verify:
- All referenced tests pass
- Direct test files exist for changed modules
- No test regressions in broader suite

### Step 4: Claim-Code (CC)

```bash
# Blast radius of changed files — verify claim scope matches actual impact
quorum tool blast_radius --path . --changed "<changed-files>"
```

Compare `git diff --name-only` against the Changed Files section. Flag:
- Files in diff but not in evidence (undocumented changes)
- Files in evidence but not in diff (phantom claims)

### Step 5: Cross-Layer (CL)

```bash
# Dependency graph — check for import cycles, cross-layer dependencies
quorum tool dependency_graph --path <changed-dir>

# Symbol map — verify exports consumed by other layers
quorum tool code_map --path <changed-dir>
```

If changes span layers (e.g., API + UI), verify contract consistency. Skip if single-layer change (mark N/A with reason).

### Step 6: Security (S)

```bash
# Hardcoded values (secrets, URLs, credentials)
quorum tool audit_scan --pattern hardcoded

# License compliance
quorum tool license_scan --path .
```

Scan changed files for missing input validation on public interfaces and auth guard presence on new endpoints.

### Step 7: i18n (I)

```bash
# Hardcoded strings, missing locale keys
quorum tool i18n_validate --path <changed-dir>
```

If locale keys were added or modified, verify they exist in ALL locale files. Skip if no i18n changes (mark N/A).

### Step 8: Frontend (FV) — if applicable

```bash
# Accessibility scan (JSX/TSX files)
quorum tool a11y_scan --path <changed-dir>

# Doc coverage for component documentation
quorum tool doc_coverage --path <changed-dir>
```

FE detection: check if changed files include `.tsx`, `.jsx`, or if `package.json` has React/Vue/Angular. Skip if no frontend changes (mark SKIP with reason).

### Step 9: Coverage (CV)

```bash
# Per-file coverage percentages
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

If all pass — "Ready for evidence submission."
If any fail — list issues with fix recommendations.

## Completeness Rule

**Every category row (1-8) must have a status:**

| Status | When |
|--------|------|
| PASS | Check ran and passed |
| FAIL (N issues) | Check ran and found problems |
| SKIP | Not applicable — **must include reason** |
| N/A | Cannot be evaluated — **must include reason** |

A report with any blank status cell is incomplete. Fill all 8 rows before outputting.
