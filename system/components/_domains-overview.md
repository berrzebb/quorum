# Domain Specialists Overview

> 11 domain knowledge files powering zero-cost specialist routing (v0.4.5)
>
> **v0.4.0**: 11 domains defined — perf, a11y, compat, compliance, concurrency, docs, i18n, infra, observability, migration, security

## What are Domain Specialists?

Domain specialists are **conditional expert reviewers** activated by file pattern matching.
- Zero-cost activation: no LLM call needed to detect domains
- Each domain has a knowledge file (`agents/knowledge/domains/*.md`) + optional MCP tool
- 9 of 11 domains have dedicated agent implementations

## Domain Detection

```
Changed files → pattern matching → detected domains → tool activation → agent routing
```

Detection is purely file-pattern-based (e.g., `*.test.*` → docs domain, `Dockerfile` → infra domain). No LLM token cost for detection.

## Full Domain List

| Domain | Knowledge File | MCP Tool | Agent | Pattern Focus |
|--------|---------------|----------|-------|---------------|
| **Performance** | perf.md | `perf_scan` | perf-analyst | N+1 queries, O(n²) loops, sync I/O in async, unbounded iteration, missing pagination |
| **Accessibility** | a11y.md | `a11y_scan` | a11y-auditor | Missing alt/label, keyboard traps, ARIA misuse, color contrast, focus management |
| **Compatibility** | compat.md | `compat_check` | compat-reviewer | API deprecation, CJS/ESM mixing, Node version constraints, breaking changes |
| **Compliance** | compliance.md | `license_scan` | compliance-officer | Copyleft contamination, PII in code, legal framework violations, unknown licenses |
| **Concurrency** | concurrency.md | — | concurrency-verifier | Race conditions, deadlocks, shared state without locks, thread safety |
| **Documentation** | docs.md | `doc_coverage` | doc-steward | JSDoc gaps, parameter docs, return type docs, example coverage |
| **Internationalization** | i18n.md | `i18n_validate` | i18n-checker | Hardcoded UI strings, locale key mismatches, Unicode handling, RTL support |
| **Infrastructure** | infra.md | `infra_scan` | infra-validator | Docker `latest` tag, missing health checks, CI secret leaks, root containers |
| **Observability** | observability.md | `observability_check` | observability-inspector | Empty catch blocks, `console.log` in prod, missing error context, silent failures |
| **Migration** | migration.md | — | — | Deprecated API usage, breaking changes, CJS→ESM migration, version upgrade risks |
| **Security** | security.md | — | — | SQL injection, XSS, hardcoded secrets, auth bypass, OWASP top 10 |

### Coverage Gaps

- **Concurrency**: Has agent but no dedicated MCP tool (relies on audit_scan patterns)
- **Migration**: Has knowledge file but no agent or tool (findings come from compat_check)
- **Security**: Has knowledge file but no dedicated tool (findings come from audit_scan + license_scan)

## Tier-Based Activation

| Tier | Domain Action |
|------|---------------|
| **T1** (skip) | No specialist activation — change too minor |
| **T2** (solo) | MCP tool runs, results included in evidence (no LLM agent) |
| **T3** (deliberative) | Full specialist agent spawned with domain knowledge + LLM reasoning |

## Knowledge File Structure

Each domain file follows a consistent format:

```markdown
# {Domain} Domain Knowledge

## Detection Patterns
- File patterns that trigger this domain

## Key Anti-Patterns
- Pattern 1: description + example
- Pattern 2: description + example

## Quality Rules
- Rule definitions for audit_scan integration

## Severity Mapping
- critical: immediate security/correctness risk
- high: significant quality concern
- medium: code smell, maintainability
- low: style, optimization opportunity
```

## Domain × Language Matrix

Domain patterns are language-aware via `languages/` fragment system:

| Language | Perf | Security | A11y | Compat | Observability |
|----------|------|----------|------|--------|---------------|
| TypeScript | `spec.perf.mjs` | ✓ (audit_scan) | `spec.a11y.mjs` | `spec.compat.mjs` | `spec.observability.mjs` |
| Go | `spec.perf.mjs` | `spec.security.mjs` | — | `spec.compat.mjs` | `spec.observability.mjs` |
| Python | `spec.perf.mjs` | `spec.security.mjs` | — | `spec.compat.mjs` | `spec.observability.mjs` |
| Rust | `spec.perf.mjs` | `spec.security.mjs` | — | `spec.compat.mjs` | `spec.observability.mjs` |
| Java | `spec.perf.mjs` | `spec.security.mjs` | — | `spec.compat.mjs` | `spec.observability.mjs` |

## Source Location

```
quorum/
├── agents/knowledge/domains/     ← 11 domain knowledge files
│   ├── perf.md
│   ├── a11y.md
│   ├── compat.md
│   ├── compliance.md
│   ├── concurrency.md
│   ├── docs.md
│   ├── i18n.md
│   ├── infra.md
│   ├── observability.md
│   ├── migration.md
│   └── security.md
├── providers/domain-detect.ts    ← Zero-cost domain detection engine
├── providers/domain-router.ts    ← Conditional specialist activation
├── providers/specialist.ts       ← Specialist review orchestrator
└── languages/*/spec.{domain}.mjs ← Language-specific patterns (5 languages)
```

## Related Documents

- [Agents Overview](_agents-overview.md) — agent ↔ domain connections
- [Tools Overview](_tools-overview.md) — MCP tools per domain
- [Graph Index](../_GRAPH-INDEX.md) — tool → domain → agent map
