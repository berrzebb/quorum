---
name: quorum-tools
description: "Run any of the 20 quorum analysis tools via CLI — codebase, quality, domain checks, RTM/FVM, and audit_history. Use whenever you need code analysis or domain checks. Triggers on 'run tool', 'scan code', 'check dependencies', 'analyze'."
argument-hint: "<tool_name> [context or parameters]"
model: gemini-2.5-flash
allowed-tools: read_file, shell, glob
---

# quorum-tools

## References
Shared references at `skills/consensus-tools/references/`. Read the relevant reference before each phase.

CLI interface for the 20 analysis tools that power the quorum workflow. These tools run via `tool-runner.mjs` — same logic as the MCP server, but invoked through shell instead of JSON-RPC.

## Tool Runner

Invocation pattern:
```bash
quorum tool <tool_name> --param value ...
```

Fallback if quorum CLI is unavailable:
```bash
node core/tools/tool-runner.mjs <tool_name> --param value ...
```

Add `--json` to any command for structured JSON output instead of formatted text.

## Tool Selection Guide

### Codebase Analysis

| Need | Tool | Reference |
|------|------|-----------|
| Find functions/classes/types with line ranges | `code_map` | [code-map.md](skills/consensus-tools/references/code-map.md) |
| Map import/export dependencies, detect cycles | `dependency_graph` | [dependency-graph.md](skills/consensus-tools/references/dependency-graph.md) |
| Compute transitive dependents of changed files | `blast_radius` | [blast-radius.md](skills/consensus-tools/references/blast-radius.md) |
| Scan for `as any`, hardcoded values, console.log | `audit_scan` | [audit-scan.md](skills/consensus-tools/references/audit-scan.md) |
| Get per-file test coverage percentages | `coverage_map` | [coverage-map.md](skills/consensus-tools/references/coverage-map.md) |
| PDCA Act — audit metrics + improvement items | `act_analyze` | [act-analyze.md](skills/consensus-tools/references/act-analyze.md) |

### Domain Scans

Language-aware scans using the **language registry** (`languages/{lang}/spec.{domain}.mjs` fragments). Each scan auto-detects project languages and applies domain-specific quality rules.

| Need | Tool | Reference |
|------|------|-----------|
| Performance regressions (N+1, O(n^2), bundle size) | `perf_scan` | [perf-scan.md](skills/consensus-tools/references/perf-scan.md) |
| Accessibility issues (missing labels, contrast) | `a11y_scan` | [a11y-scan.md](skills/consensus-tools/references/a11y-scan.md) |
| API compatibility breaks, deprecation usage | `compat_check` | [compat-check.md](skills/consensus-tools/references/compat-check.md) |
| Hardcoded strings, missing locale keys | `i18n_validate` | [i18n-validate.md](skills/consensus-tools/references/i18n-validate.md) |
| License compliance (GPL in MIT project, etc.) | `license_scan` | [license-scan.md](skills/consensus-tools/references/license-scan.md) |
| Infrastructure misconfigs, env issues | `infra_scan` | [infra-scan.md](skills/consensus-tools/references/infra-scan.md) |
| Missing logging, metrics, tracing | `observability_check` | [observability-check.md](skills/consensus-tools/references/observability-check.md) |
| Missing/stale JSDoc, docstrings | `doc_coverage` | [doc-coverage.md](skills/consensus-tools/references/doc-coverage.md) |

### Supported Languages

Domain scans are **language-aware** — the registry (`languages/{lang}/spec.{domain}.mjs`) auto-detects project languages and applies language-specific patterns. Currently supports TypeScript, Go, Python, Rust, Java (5 languages x 7 fragments each).

### RTM & FVM

| Need | Tool | Reference |
|------|------|-----------|
| Read RTM rows, filter by req_id or status | `rtm_parse` | [rtm-parse.md](skills/consensus-tools/references/rtm-parse.md) |
| Merge worktree RTM files into base | `rtm_merge` | [rtm-merge.md](skills/consensus-tools/references/rtm-merge.md) |
| Generate FE x API x BE x Auth verification matrix | `fvm_generate` | [fvm-generate.md](skills/consensus-tools/references/fvm-generate.md) |
| Execute FVM rows against live server | `fvm_validate` | [fvm-validate.md](skills/consensus-tools/references/fvm-validate.md) |

### Audit & Guide

| Need | Tool | Reference |
|------|------|-----------|
| Query verdict history, detect rejection patterns | `audit_history` | [audit-history.md](skills/consensus-tools/references/audit-history.md) |
| Project onboarding guide (synthesized overview) | `ai_guide` | [ai-guide.md](skills/consensus-tools/references/ai-guide.md) |

## Gemini Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Find files | `glob` |
| Run command | `shell` |

## Quick Examples

```bash
# Symbol index for a directory
quorum tool code_map --path src/

# Dependency graph with cycle detection
quorum tool dependency_graph --path src/ --depth 3

# Blast radius of changed files
quorum tool blast_radius --path src/ --changed "bus/store.ts,bus/lock.ts"

# Performance scan (hybrid: regex + AST)
quorum tool perf_scan --path src/

# Accessibility scan (JSX/TSX only)
quorum tool a11y_scan --path src/components/

# Pattern scan for type-safety issues
quorum tool audit_scan --pattern type-safety

# Audit history summary
quorum tool audit_history --summary --json
```

## Error Handling

- Exit code 0 = success (text to stdout, summary to stderr)
- Exit code 1 = error (message to stderr)
- Missing required params = error message lists what's needed
- `--json` flag outputs structured JSON for programmatic use

## Tool References

For detailed parameters and examples for each tool, see: `skills/consensus-tools/references/`
