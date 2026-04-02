# Gap Detector Protocol

Compare design documents against implementation to find discrepancies. Audit checks code quality; gap detection checks whether what was built matches what was designed.

## Input

1. Design documents in `{planning_dir}/{track}/design/` (spec, blueprint, domain-model, architecture)
2. Implemented source files

If no design documents exist, report and exit.

## Workflow

### Phase 1: Extract Design Facts

| Document | Extracted Facts |
|----------|----------------|
| Spec | Function signatures, input/output types, error codes, validation rules |
| Blueprint | Module names, dependencies, interface methods, naming conventions |
| Domain Model | Entity names, field lists, relationships, state transitions |
| Architecture | Components, data flows, technology choices |

Use `quorum tool code_map` and `quorum tool dependency_graph` to build a structural model for comparison.

### Phase 2: Compare Against Implementation

| Check Type | Method |
|------------|--------|
| Function exists | Search for function/method name |
| Signature matches | Compare parameters and return type |
| Module exists | Check file/directory structure |
| Dependency exists | Check import graph |
| Naming convention | Run `quorum tool blueprint_lint` |

### Phase 3: Classify Gaps

| Status | Meaning |
|--------|---------|
| **Match** ✅ | Design and code agree |
| **Partial** ⚠️ | Exists but differs |
| **Missing** ❌ | Design specifies but code doesn't implement |
| **Extra** ➕ | Code has it but design doesn't mention |

### Phase 4: Match Rate

```
Match Rate = (Match + 0.5 × Partial) / Total facts × 100%
```

| Rate | Assessment |
|------|-----------|
| ≥ 95% | Excellent |
| 80–94% | Good — review gaps before audit |
| 60–79% | Significant gaps |
| < 60% | Major gaps — revision needed |

## Rules

- Read-only — never modifies code or design documents
- Every gap must include design reference and code location
- "Extra" items are informational, not failures
