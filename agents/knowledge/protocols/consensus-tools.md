# Consensus Tools Protocol

Interface for the 20 analysis tools that power the quorum workflow.

## Invocation

```
quorum tool <tool_name> [--param value ...] [--json]
```

## Tool Selection Guide

### Codebase Analysis (6)

| Need | Tool | Reference |
|------|------|-----------|
| Symbol index | `code_map` | `references/consensus-tools/code-map.md` |
| Import/export graph | `dependency_graph` | `references/consensus-tools/dependency-graph.md` |
| Transitive dependents | `blast_radius` | `references/consensus-tools/blast-radius.md` |
| Pattern scan (as any, hardcoded) | `audit_scan` | `references/consensus-tools/audit-scan.md` |
| Per-file test coverage | `coverage_map` | `references/consensus-tools/coverage-map.md` |
| PDCA improvement items | `act_analyze` | `references/consensus-tools/act-analyze.md` |

### Domain Scans (8)

Language-aware scans using `languages/{lang}/spec.{domain}.mjs` fragments.

| Need | Tool | Reference |
|------|------|-----------|
| Performance regressions | `perf_scan` | `references/consensus-tools/perf-scan.md` |
| Accessibility | `a11y_scan` | `references/consensus-tools/a11y-scan.md` |
| API compatibility | `compat_check` | `references/consensus-tools/compat-check.md` |
| Hardcoded strings | `i18n_validate` | `references/consensus-tools/i18n-validate.md` |
| License compliance | `license_scan` | `references/consensus-tools/license-scan.md` |
| Infrastructure | `infra_scan` | `references/consensus-tools/infra-scan.md` |
| Logging/metrics gaps | `observability_check` | `references/consensus-tools/observability-check.md` |
| Documentation completeness | `doc_coverage` | `references/consensus-tools/doc-coverage.md` |

### RTM & FVM (4)

| Need | Tool | Reference |
|------|------|-----------|
| Parse RTM rows | `rtm_parse` | `references/consensus-tools/rtm-parse.md` |
| Merge worktree RTM | `rtm_merge` | `references/consensus-tools/rtm-merge.md` |
| FE×API×BE verification matrix | `fvm_generate` | `references/consensus-tools/fvm-generate.md` |
| Execute FVM against server | `fvm_validate` | `references/consensus-tools/fvm-validate.md` |

### Audit & Guide (2)

| Need | Tool | Reference |
|------|------|-----------|
| Verdict history | `audit_history` | `references/consensus-tools/audit-history.md` |
| Project onboarding guide | `ai_guide` | `references/consensus-tools/ai-guide.md` |

## Supported Languages (5 × 7 fragments)

| Language | Domain Fragments |
|----------|-----------------|
| TypeScript | symbols, imports, perf, a11y, compat, observability, doc |
| Go | symbols, imports, perf, security, observability, compat, doc |
| Python | symbols, imports, perf, security, observability, compat, doc |
| Rust | symbols, imports, perf, security, observability, compat, doc |
| Java | symbols, imports, perf, security, observability, compat, doc |

## Error Handling

- Exit 0 = success, Exit 1 = error
- `--json` for structured output
