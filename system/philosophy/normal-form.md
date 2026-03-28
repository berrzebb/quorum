# Normal Form Convergence

> quorum's value is not improving initial output quality — it's owning the structure that converges ANY starting quality to 100% conformance.

## The Theory

In database theory, Normal Form is a state where data is organized to eliminate redundancy and dependency anomalies. In quorum, Normal Form is a state where **any implementer produces structurally identical output** given the same requirements and laws.

```
impl(Model A, law) = impl(Model B, law) = Normal Form
```

The key insight: it doesn't matter which model wrote the first draft, how many iterations it took, or what quality the initial output was. The parliamentary process (audit + confluence + amendments) converges all paths to the same destination.

## Convergence Path

Every implementation follows a 4-stage path:

```
Raw Output ──▶ Autofix ──▶ Manual Fix ──▶ Normal Form (100%)
    │              │            │              │
    │         Fitness gate  Audit findings   Confluence
    │         auto-corrects  addressed       verified
    │
    ▼
 Starting quality varies by model,
 but the destination is the same.
```

### Stage 1: Raw Output
The implementer produces initial code. Quality varies wildly — a frontier model might start at 80%, a smaller model at 40%.

### Stage 2: Autofix
The fitness gate (7-component score) detects measurable regressions and triggers self-correction. No LLM needed — deterministic tools identify type errors, test failures, pattern violations.

### Stage 3: Manual Fix
Audit findings (T2 solo or T3 deliberative) surface issues that require reasoning — architectural mismatches, missing edge cases, design violations. The implementer corrects based on specific feedback.

### Stage 4: Normal Form
Confluence verification confirms whole-system integrity:
- **Law↔Code**: Does the implementation match the audit verdict?
- **Part↔Whole**: Do integration tests pass?
- **Intent↔Result**: Does the CPS gap list shrink?
- **Law↔Law**: Do amendments contradict each other?

## Conformance Metric

```
Conformance = fitness(40%) + audit_pass_rate(40%) + confluence(20%)
```

Per-provider tracking reveals which models converge faster, but all must reach the same Normal Form. A model that passes fitness but fails confluence is not "better" — it's just faster to a partial state.

## Why This Matters

Traditional code review asks: "Is this code good?" — a subjective question with no convergent answer.

quorum asks: "Does this code match Normal Form?" — an objective question with a deterministic answer.

This shifts the burden from **trusting the reviewer** to **trusting the system**. The system's laws (requirements, design conventions, architectural constraints) define Normal Form. The parliamentary process enforces convergence. The result is reproducible quality regardless of who (human or AI) wrote the code.

## Related

- [Core Mission](core-mission.md) — why structural enforcement
- [Consensus Protocol](consensus-protocol.md) — the mechanism that drives convergence
