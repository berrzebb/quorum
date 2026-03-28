---
name: quorum:tools
description: "Run any of the 20 quorum analysis tools — codebase, quality, domain checks, RTM/FVM, and audit history. Use whenever you need code analysis or domain checks."
---

# Consensus Tools

Interface for the 20 analysis tools that power the quorum workflow.

## Invocation

```
quorum tool <tool_name> [--param value ...]
```

Add `--json` to any command for structured JSON output instead of formatted text.

## Tool Selection Guide

### Codebase Analysis

| Need | Tool | Reference |
|------|------|-----------|
| Find functions/classes/types with line ranges | `code_map` | `references/code-map.md` |
| Map import/export dependencies, detect cycles | `dependency_graph` | `references/dependency-graph.md` |
| Compute transitive dependents of changed files | `blast_radius` | `references/blast-radius.md` |
| Scan for `as any`, hardcoded values, console.log | `audit_scan` | `references/audit-scan.md` |
| Get per-file test coverage percentages | `coverage_map` | `references/coverage-map.md` |
| PDCA Act — audit metrics + improvement items | `act_analyze` | `references/act-analyze.md` |

### Domain Scans

Language-aware scans using the **language registry** (`languages/{lang}/spec.{domain}.mjs` fragments). Each scan auto-detects project languages and applies domain-specific quality rules. See `references/languages.md` for supported languages and fragments.

| Need | Tool | Reference |
|------|------|-----------|
| Performance regressions (N+1, O(n^2), bundle size) | `perf_scan` | `references/perf-scan.md` |
| Accessibility issues (missing labels, contrast) | `a11y_scan` | `references/a11y-scan.md` |
| API compatibility breaks, deprecation usage | `compat_check` | `references/compat-check.md` |
| Hardcoded strings, missing locale keys | `i18n_validate` | `references/i18n-validate.md` |
| License compliance (GPL in MIT project, etc.) | `license_scan` | `references/license-scan.md` |
| Infrastructure misconfigs, env issues | `infra_scan` | `references/infra-scan.md` |
| Missing logging, metrics, tracing | `observability_check` | `references/observability-check.md` |
| Missing/stale JSDoc, docstrings | `doc_coverage` | `references/doc-coverage.md` |

### Supported Languages

Domain scans are **language-aware** — the registry auto-detects project languages and applies language-specific patterns. Currently supports 5 languages x 7 fragments each:

| Language | Domain Fragments |
|----------|-----------------|
| TypeScript | symbols, imports, perf, a11y, compat, observability, doc |
| Go | symbols, imports, perf, security, observability, compat, doc |
| Python | symbols, imports, perf, security, observability, compat, doc |
| Rust | symbols, imports, perf, security, observability, compat, doc |
| Java | symbols, imports, perf, security, observability, compat, doc |

### RTM & FVM

| Need | Tool | Reference |
|------|------|-----------|
| Read RTM rows, filter by req_id or status | `rtm_parse` | `references/rtm-parse.md` |
| Merge worktree RTM files into base | `rtm_merge` | `references/rtm-merge.md` |
| Generate FE x API x BE x Auth verification matrix | `fvm_generate` | `references/fvm-generate.md` |
| Execute FVM rows against live server | `fvm_validate` | `references/fvm-validate.md` |

### Audit & Guide

| Need | Tool | Reference |
|------|------|-----------|
| Query verdict history, detect rejection patterns | `audit_history` | `references/audit-history.md` |
| Project onboarding guide (synthesized overview) | `ai_guide` | `references/ai-guide.md` |

## Error Handling

- Exit code 0 = success (text to stdout, summary to stderr)
- Exit code 1 = error (message to stderr)
- Missing required params = error message lists what's needed
- `--json` flag outputs structured JSON for programmatic use
