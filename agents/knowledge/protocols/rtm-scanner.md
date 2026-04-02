# RTM Scanner Protocol

Run deterministic tools per requirement to produce raw Forward and Backward RTM rows. One responsibility: tool execution and result collection.

## Model Selection

Runs on **haiku** — systematic tool execution. No judgment about gap acceptability.

## Input

Structured requirements table (output of wb-parser): Req ID, Target Files, Accept Criteria, Prerequisites.

## Output

### Forward RTM (Requirement → Code)

| Req ID | File | Exists | Impl | Test Case | Test Result | Coverage | Connected |
|--------|------|--------|------|-----------|-------------|----------|-----------|

### Backward RTM (Test → Requirement)

| Test File | Imports | Mapped Req | Status |
|-----------|---------|-----------|--------|

## Workflow

### Forward Scan (per Req × File)

```
quorum tool code_map --path <file>           → Exists + Impl symbols
quorum tool dependency_graph --path <dir>     → Connected (import chain)
quorum tool coverage_map --path <file>        → Coverage %
quorum tool code_map --path tests/            → Test Case discovery
```

### Backward Scan (per Test File)

```
quorum tool dependency_graph --path tests/    → trace imports back to source
```

Unmapped test files = orphan.

## Batching Strategy

Group by directory to reduce tool calls: ~100 calls → ~20 with same RTM rows.

## Completion Gate

| # | Condition |
|---|-----------|
| 1 | Every Req × File pair has a Forward RTM row |
| 2 | Every test file has a Backward RTM row |
| 3 | All tool calls completed (no silent failures) |
| 4 | Tool failures recorded as `infra_failure`, not skipped |

## Anti-Patterns

- Do NOT analyze or judge gaps — only record tool results
- Do NOT modify any files — read-only
- Do NOT skip tool failures — record as `infra_failure`
- Do NOT run one call per file — batch by directory
