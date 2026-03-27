---
name: quorum:gap-detector
description: "Detect gaps between design documents and actual implementation. Compares Spec, Blueprint, Domain Model against codebase to produce a Match Rate and gap report. Different from audit — this checks design intent vs code reality. Triggers on 'check gaps', 'design vs code', 'match rate', 'implementation gaps', '설계 갭', '구현 확인', '매치율'."
argument-hint: "<track name or design directory path>"
context: fork
mergeResult: false
permissionMode: plan
memory: project
skills:
  - consensus-tools
tools:
  - read
  - glob
  - grep
  - bash
hooks: {}
---

# Gap Detector

Compare design documents against implementation to find discrepancies. Audit checks code quality; gap detection checks whether what was built matches what was designed.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | — | — |
| 2. Planning | — | — |
| 3. Design | Consumes design documents as baseline | input |
| 4. Implementation | Consumes implemented code | input |
| 5. **Verification** | **Compares design vs code, produces Match Rate** | **✅ primary** |
| 6. Audit | Match Rate informs audit evidence | downstream |
| 7. **Convergence** | **Re-run per iteration to track convergence** | **✅ secondary** |
| 8. Retrospective | — | — |

## When to Use

- After implementation is complete, before audit submission
- During iterative development to check progress against design
- When audit findings suggest design drift
- When refactoring code that has existing design documents

## Input Requirements

1. **Design documents** in `{planning_dir}/{track}/design/` (at least one of: spec.md, blueprint.md, domain-model.md, architecture.md)
2. **Implemented source files** (the code being compared)

If no design documents exist, report this and exit — gap detection requires a design baseline.

## Workflow

### Phase 1: Extract Design Facts

Parse each design document to extract verifiable claims:

| Document | Extracted Facts |
|----------|----------------|
| **Spec** | Function signatures, input/output types, error codes, validation rules |
| **Blueprint** | Module names, module dependencies, interface methods, naming conventions |
| **Domain Model** | Entity names, field lists, relationships (cardinality), state transitions |
| **Architecture** | Components, data flows (source→target), technology choices |

Use `quorum tool code_map` and `quorum tool dependency_graph` to build a structural model of the codebase for comparison.

### Phase 2: Compare Against Implementation

For each extracted fact, search the codebase:

| Check Type | Method | Match Criteria |
|------------|--------|---------------|
| **Function exists** | Search for function/method name | Exact name match |
| **Signature matches** | Compare parameters and return type | Type-compatible |
| **Module exists** | Check file/directory structure | Path exists |
| **Dependency exists** | Check import graph | Import present |
| **Entity exists** | Search for class/interface/type | Name match with expected fields |
| **State transition** | Search for state handling logic | All transitions present |
| **Naming convention** | Run `quorum tool blueprint_lint` | No violations |

### Phase 3: Classify Gaps

Each fact falls into one of 4 categories:

| Status | Meaning | Icon |
|--------|---------|------|
| **Match** | Design and code agree | ✅ |
| **Partial** | Exists but differs (extra params, missing fields) | ⚠️ |
| **Missing** | Design specifies but code doesn't implement | ❌ |
| **Extra** | Code has it but design doesn't mention it | ➕ |

### Phase 4: Match Rate Calculation

```
Match Rate = (Match count + 0.5 × Partial count) / Total facts × 100%
```

| Rate | Assessment |
|------|-----------|
| ≥ 95% | Excellent — minor gaps only |
| 80–94% | Good — review gaps before audit |
| 60–79% | Significant gaps — implementation incomplete |
| < 60% | Major gaps — design or implementation needs revision |

### Phase 5: Gap Report

Output a structured gap report:

```markdown
# Gap Analysis: {Track Name}

**Match Rate: {N}%** ({match}/{total} facts verified)

## Summary
| Category | Count |
|----------|-------|
| ✅ Match | {n} |
| ⚠️ Partial | {n} |
| ❌ Missing | {n} |
| ➕ Extra | {n} |

## Gaps Detail

### ❌ Missing: FR-3 retry logic
- **Design**: Spec line 42 — "Retry with exponential backoff, max 3 attempts"
- **Code**: No retry logic found in `src/api/client.ts`
- **Impact**: HIGH — data loss on transient failures

### ⚠️ Partial: UserService interface
- **Design**: Blueprint — `UserService.findById(id: string): Promise<User>`
- **Code**: `UserService.findById(id: number): Promise<User | null>` (type mismatch)
- **Impact**: MEDIUM — type inconsistency

## Recommendations
1. Implement missing retry logic (FR-3)
2. Align UserService.findById parameter type with spec
```

## Tools Used

```
quorum tool code_map --path <src-dir>
quorum tool dependency_graph --path <src-dir>
quorum tool blueprint_lint --path <design-dir>
```

## Rules

- Read-only — gap detection never modifies code or design documents
- Every gap must include both the design reference (file + line) and the code location
- Match Rate is informational — it does not gate anything by itself
- "Extra" items are informational, not failures — code may legitimately exceed design scope

## Anti-Patterns

- Do NOT modify code to match design — report only, let the implementer decide
- Do NOT count test files as implementation gaps
- Do NOT flag intentional deviations without checking for Amendment records
- Do NOT run without design documents — exit early with a clear message
