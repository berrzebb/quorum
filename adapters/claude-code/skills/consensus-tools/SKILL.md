---
name: quorum:tools
description: "Run any of the 20 quorum analysis tools via CLI — codebase (code_map, dependency_graph, blast_radius), quality (audit_scan, coverage_map, perf_scan, a11y_scan), domain checks (compat, i18n, license, infra, observability, doc_coverage), RTM/FVM, and audit_history. Use whenever you need code analysis, pattern scanning, or domain checks — even if the MCP server is unavailable. Triggers on 'run tool', 'scan code', 'check dependencies', 'analyze', '도구 실행'."
argument-hint: "<tool_name> [context or parameters]"
model: claude-sonnet-4-6
allowed-tools: Read, Bash(node *), Bash(git *)
---

# quorum:tools

CLI interface for the 20 analysis tools that power the quorum workflow. These tools run via `tool-runner.mjs` — same logic as the MCP server, but invoked through Bash instead of JSON-RPC.

## Tool Runner Path

```
${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs
```

Invocation pattern:
```bash
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs <tool_name> --param value ...
```

Add `--json` to any command for structured JSON output instead of formatted text.

## Tool Selection Guide

### Codebase Analysis

| Need | Tool | Reference |
|------|------|-----------|
| Find functions/classes/types with line ranges | `code_map` | [code-map.md](references/code-map.md) |
| Map import/export dependencies, detect cycles | `dependency_graph` | [dependency-graph.md](references/dependency-graph.md) |
| Compute transitive dependents of changed files | `blast_radius` | [blast-radius.md](references/blast-radius.md) |
| Scan for `as any`, hardcoded values, console.log | `audit_scan` | [audit-scan.md](references/audit-scan.md) |
| Get per-file test coverage percentages | `coverage_map` | [coverage-map.md](references/coverage-map.md) |
| PDCA Act — audit metrics + improvement items | `act_analyze` | [act-analyze.md](references/act-analyze.md) |

### Domain Scans

Language-aware scans using the **language registry** (`languages/{lang}/spec.{domain}.mjs` fragments). Each scan auto-detects project languages and applies domain-specific quality rules.

| Need | Tool | Reference |
|------|------|-----------|
| Performance regressions (N+1, O(n²), bundle size) | `perf_scan` | [perf-scan.md](references/perf-scan.md) |
| Accessibility issues (missing labels, contrast) | `a11y_scan` | [a11y-scan.md](references/a11y-scan.md) |
| API compatibility breaks, deprecation usage | `compat_check` | [compat-check.md](references/compat-check.md) |
| Hardcoded strings, missing locale keys | `i18n_validate` | [i18n-validate.md](references/i18n-validate.md) |
| License compliance (GPL in MIT project, etc.) | `license_scan` | [license-scan.md](references/license-scan.md) |
| Infrastructure misconfigs, env issues | `infra_scan` | [infra-scan.md](references/infra-scan.md) |
| Missing logging, metrics, tracing | `observability_check` | [observability-check.md](references/observability-check.md) |
| Missing/stale JSDoc, docstrings | `doc_coverage` | [doc-coverage.md](references/doc-coverage.md) |

### Supported Languages

Domain scans are **language-aware** — the registry (`languages/{lang}/spec.{domain}.mjs`) auto-detects project languages and applies language-specific patterns. Currently supports TypeScript, Go, Python, Rust, Java (5 languages × 7 fragments each).

Read `references/languages.md` for the full coverage matrix, pattern format, and how to add new languages.

### RTM & FVM

| Need | Tool | Reference |
|------|------|-----------|
| Read RTM rows, filter by req_id or status | `rtm_parse` | [rtm-parse.md](references/rtm-parse.md) |
| Merge worktree RTM files into base | `rtm_merge` | [rtm-merge.md](references/rtm-merge.md) |
| Generate FE×API×BE×Auth verification matrix | `fvm_generate` | [fvm-generate.md](references/fvm-generate.md) |
| Execute FVM rows against live server | `fvm_validate` | [fvm-validate.md](references/fvm-validate.md) |

### Audit & Guide

| Need | Tool | Reference |
|------|------|-----------|
| Query verdict history, detect rejection patterns | `audit_history` | [audit-history.md](references/audit-history.md) |
| Project onboarding guide (synthesized overview) | `ai_guide` | [ai-guide.md](references/ai-guide.md) |

## Quick Examples

```bash
# Symbol index for a directory
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs code_map --path src/

# Dependency graph with cycle detection
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs dependency_graph --path src/ --depth 3

# Blast radius of changed files
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs blast_radius --path src/ --changed "bus/store.ts,bus/lock.ts"

# Performance scan (hybrid: regex + AST)
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs perf_scan --path src/

# Accessibility scan (JSX/TSX only)
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs a11y_scan --path src/components/

# Compatibility check
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs compat_check --path src/

# i18n validation
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs i18n_validate --path src/

# License scan
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs license_scan --path .

# Observability check (missing logging/metrics)
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs observability_check --path src/

# Doc coverage
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs doc_coverage --path src/

# Pattern scan for type-safety issues
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_scan --pattern type-safety

# Parse RTM, filter by requirement ID
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs rtm_parse --path docs/rtm.md --req_id EV-1

# Audit history summary
node ${CLAUDE_PLUGIN_ROOT}/core/tools/tool-runner.mjs audit_history --summary --json
```

## Error Handling

- Exit code 0 = success (text to stdout, summary to stderr)
- Exit code 1 = error (message to stderr)
- Missing required params → error message lists what's needed
- `--json` flag outputs structured JSON for programmatic use

## MCP ↔ CLI Equivalence

Every MCP tool call maps 1:1 to a CLI command:

| MCP Call | CLI Equivalent |
|----------|---------------|
| `mcp__quorum__code_map({path: "src/"})` | `node tool-runner.mjs code_map --path src/` |
| `mcp__quorum__blast_radius({path: "src/", changed: "a.ts"})` | `node tool-runner.mjs blast_radius --path src/ --changed a.ts` |
| `mcp__quorum__perf_scan({path: "src/"})` | `node tool-runner.mjs perf_scan --path src/` |
| `mcp__quorum__a11y_scan({path: "src/"})` | `node tool-runner.mjs a11y_scan --path src/` |
| `mcp__quorum__audit_history({summary: true})` | `node tool-runner.mjs audit_history --summary` |

The output format is identical — same text, same summary.
