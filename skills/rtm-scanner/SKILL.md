---
name: quorum:rtm-scanner
description: "Trace requirements against codebase using deterministic tools. Takes structured requirements from wb-parser, runs code_map/dependency_graph/coverage_map per requirement, outputs raw RTM rows. Single responsibility: tool-based tracing. Triggers on 'scan RTM', 'trace requirements', 'RTM 스캔', '추적성 검사'."
argument-hint: "<path to requirements table or track name>"
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

# RTM Scanner

Run deterministic tools per requirement to produce raw Forward and Backward RTM rows. One responsibility: tool execution and result collection.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | — | — |
| 2. Planning | Consumes requirements from wb-parser | input |
| 3. Design | — | — |
| 4. Implementation | — | — |
| 5. **Verification** | **Runs tools per requirement, produces RTM rows** | **✅ primary** |
| 6. Audit | RTM rows feed into scout analysis | downstream |
| 7. Convergence | Re-run to track implementation progress | secondary |
| 8. Retrospective | — | — |

## Model Selection

Runs on **haiku** — this is systematic tool execution. For each requirement, run the same set of tools and record results. No judgment about whether gaps are acceptable.

## Input

Structured requirements table (output of `quorum:wb-parser`):
- Req ID, Target Files, Accept Criteria, Prerequisites

## Output

Two RTM tables:

### Forward RTM (Requirement → Code)

```markdown
| Req ID | File | Exists | Impl | Test Case | Test Result | Coverage | Connected |
|--------|------|--------|------|-----------|-------------|----------|-----------|
| WB-1 | src/auth/middleware.ts | ✅ | ✅ | tests/auth.test.ts | PASS | 87% | ✅ |
| WB-2 | src/auth/session.ts | ✅ | ⚠️ partial | — | — | 0% | ✅ |
| WB-3 | src/auth/rbac.ts | ❌ | ❌ | — | — | — | — |
```

### Backward RTM (Test → Requirement)

```markdown
| Test File | Imports | Mapped Req | Status |
|-----------|---------|-----------|--------|
| tests/auth.test.ts | src/auth/middleware.ts | WB-1 | mapped |
| tests/utils.test.ts | src/utils/helper.ts | — | orphan |
```

## Workflow

### Forward Scan (per Req × File)

For each requirement's target files, run 5 tool checks:

```
quorum tool code_map --path <file>           → Exists + Impl symbols
quorum tool dependency_graph --path <dir>     → Connected (import chain)
quorum tool coverage_map --path <file>        → Coverage %
quorum tool code_map --path tests/            → Test Case discovery
```

Record each result as a row in the Forward RTM.

### Backward Scan (per Test File)

```
quorum tool dependency_graph --path tests/    → trace imports back to source
```

For each test file, check if its imports map to any requirement's target files. Unmapped = orphan.

## Batching Strategy

To manage context size, batch tool calls:
- Group requirements by directory (shared `code_map` calls)
- Run `dependency_graph` once per source directory, not per file
- Run `coverage_map` once per directory, extract per-file data

This reduces 100 tool calls to ~20 while producing the same RTM rows.

## Completion Gate

| # | Condition |
|---|-----------|
| 1 | Every Req × File pair has a Forward RTM row |
| 2 | Every test file has a Backward RTM row |
| 3 | All tool calls completed (no silent failures) |
| 4 | Tool failures recorded as `infra_failure` in the row, not skipped |

## Anti-Patterns

- Do NOT analyze or judge gaps — only record tool results
- Do NOT modify any files — read-only tool execution
- Do NOT skip tool failures — record them as `infra_failure`
- Do NOT run one tool call per file — batch by directory
- Do NOT assess requirement quality — that's the scout's job
