# MCP Tools Overview

> 22 deterministic analysis tools registered in quorum (v0.4.5)
>
> **v0.3.0**: 6 core tools (code_map, dependency_graph, audit_scan, rtm_parse, rtm_merge, coverage_map)
> **v0.4.0**: 8 domain tools (perf_scan, a11y_scan, compat_check, license_scan, i18n_validate, infra_scan, observability_check, doc_coverage)
> **v0.4.2**: blueprint_lint, contract_drift, ai_guide, agent_comm, audit_submit
> **v0.4.5**: fvm_generate, fvm_validate, act_analyze, audit_history

## What are MCP Tools?

MCP (Model Context Protocol) tools are **deterministic analysis functions** exposed to AI assistants.
- Run without LLM — pure code analysis producing structured JSON output
- Registered in `platform/core/tools/mcp-server.mjs` as a single MCP server
- Used by domain specialists to establish facts before LLM reasoning
- Available to any adapter (Claude Code, Gemini, Codex) via MCP protocol

## Tool Classification

### Codebase Analysis (5)

| Tool | Purpose | Output |
|------|---------|--------|
| **code_map** | Zero-token symbol index (functions, classes, exports) | Matrix of symbols per file |
| **dependency_graph** | Import/export DAG, connected components, cycles | Graph with topological sort |
| **blast_radius** | BFS on reverse import graph → transitive dependents | List of affected files + ratio |
| **audit_scan** | Type-safety, hardcoded strings, console.log patterns | Finding list with severity |
| **coverage_map** | Per-file test coverage from vitest/jest | Coverage percentages |

### Domain Scans (8)

Each tool corresponds to a domain specialist agent:

| Tool | Domain | Patterns Detected |
|------|--------|-------------------|
| **perf_scan** | Performance | N+1 queries, O(n²) loops, sync I/O, unbounded iteration |
| **a11y_scan** | Accessibility | Missing labels, keyboard traps, ARIA violations (JSX) |
| **compat_check** | Compatibility | API deprecation, CJS/ESM mixing, version constraints |
| **license_scan** | Compliance | Copyleft contamination, PII patterns, unknown licenses |
| **i18n_validate** | Internationalization | Hardcoded UI strings, locale key mismatches |
| **infra_scan** | Infrastructure | Docker security, CI config anti-patterns, container policy |
| **observability_check** | Observability | Empty catch blocks, missing logs, console.log in prod |
| **doc_coverage** | Documentation | JSDoc coverage percentage, undocumented exports |

### RTM & Verification (4)

| Tool | Purpose | Output |
|------|---------|--------|
| **rtm_parse** | Parse RTM markdown, filter by Req ID/status | Structured requirement rows |
| **rtm_merge** | Row-level merge of worktree RTMs | Merged RTM markdown |
| **fvm_generate** | FE route × API × BE endpoint verification matrix | Cross-layer coverage matrix |
| **fvm_validate** | Execute FVM rows against live server | Pass/fail per endpoint |

### Audit & Governance (3)

| Tool | Purpose | Output |
|------|---------|--------|
| **audit_history** | Query persistent audit history, trends | Historical verdicts + patterns |
| **audit_submit** | Store evidence in SQLite, trigger evaluation | Trigger score + tier decision |
| **act_analyze** | Audit history + FVM → improvement items | Actionable improvement list |

### Synthesis & Communication (2)

| Tool | Purpose | Output |
|------|---------|--------|
| **ai_guide** | Project onboarding guide generation | Structured project overview |
| **agent_comm** | Inter-agent query/response protocol | Response from target agent |

### Enforcement (2)

| Tool | Purpose | Output |
|------|---------|--------|
| **blueprint_lint** | Design naming convention violations | Violation list with alternatives |
| **contract_drift** | Type definition ↔ implementation mismatches | Drift report |

## Hybrid Scanning

Some tools use a two-pass approach:

```
Pass 1: Regex scan (fast, broad)
    │
    ▼
Pass 2: AST refinement (precise, targeted)
    │
    ▼
Result: High-precision findings with low false positives
```

`perf_scan` is the first hybrid tool. The `runPatternScan` function accepts an optional `astRefine` callback that uses TypeScript Compiler API for second-pass validation.

## Scan-Ignore Pragma

Add `// scan-ignore` to any source line to suppress `runPatternScan` findings on that line. Used for self-referential pattern definitions (e.g., perf_scan's own regex patterns).

## Tool Usage in Consensus Flow

```
Evidence submitted (code edit)
       │
       ▼
Trigger Evaluation (13 factors)
       │
       ├── blast_radius → factor score
       ├── audit_scan → pattern count
       ├── coverage_map → gap detection
       │
       ▼
Domain Detection (zero-cost)
       │
       ├── perf_scan → perf findings
       ├── a11y_scan → a11y findings
       ├── ... (per detected domain)
       │
       ▼
Evidence enriched with tool results
       │
       ▼
Auditor receives facts, not raw code
```

## Tool Source Location

```
quorum/
├── platform/core/tools/
│   ├── mcp-server.mjs           ← MCP server registration (all 22 tools)
│   ├── code-map.mjs             ← code_map
│   ├── dependency-graph.mjs     ← dependency_graph
│   ├── blast-radius.mjs         ← blast_radius
│   ├── audit-scan.mjs           ← audit_scan
│   ├── coverage-map.mjs         ← coverage_map
│   ├── perf-scan.mjs            ← perf_scan (hybrid)
│   ├── a11y-scan.mjs            ← a11y_scan
│   ├── compat-check.mjs         ← compat_check
│   ├── license-scan.mjs         ← license_scan
│   ├── i18n-validate.mjs        ← i18n_validate
│   ├── infra-scan.mjs           ← infra_scan
│   ├── observability-check.mjs  ← observability_check
│   ├── doc-coverage.mjs         ← doc_coverage
│   ├── rtm-parse.mjs            ← rtm_parse
│   ├── rtm-merge.mjs            ← rtm_merge
│   ├── fvm-generate.mjs         ← fvm_generate
│   ├── fvm-validate.mjs         ← fvm_validate
│   ├── audit-history.mjs        ← audit_history
│   ├── act-analyze.mjs          ← act_analyze
│   ├── blueprint-lint.mjs       ← blueprint_lint
│   ├── contract-drift.mjs       ← contract_drift
│   ├── ai-guide.mjs             ← ai_guide
│   ├── agent-comm.mjs           ← agent_comm
│   ├── audit-submit.mjs         ← audit_submit
│   └── ast-bridge.mjs           ← Fail-safe MJS↔AST bridge
├── providers/ast-analyzer.ts    ← TypeScript Compiler API wrapper
└── languages/                   ← Language-specific scan patterns
    ├── typescript/spec.*.mjs
    ├── go/spec.*.mjs
    ├── python/spec.*.mjs
    ├── rust/spec.*.mjs
    └── java/spec.*.mjs
```

## Related Documents

- [Domains Overview](_domains-overview.md) — domain knowledge behind tools
- [Agents Overview](_agents-overview.md) — agents that use these tools
- [Skills: consensus-tools](../../skills/consensus-tools/SKILL.md) — skill with 21 reference files
- [Public TOOLS.md](../../docs/TOOLS.md) — user-facing tool documentation
