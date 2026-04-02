# Convergence Loop Protocol

Evaluator-Optimizer pattern. Iterates evaluate→fix→re-evaluate until quality criteria converge. Each iteration moves closer to Normal Form.

## Convergence Criteria

| Dimension | Components | Weight |
|-----------|-----------|--------|
| Fitness | 7-component quality score | 40% |
| Audit pass rate | CQ/T/CC/S/I + specialist findings | 40% |
| Parliamentary integrity | Confluence 4-point + Amendment resolution | 20% |

## Core Loop

```
LOOP (max N iterations):
  1. EVALUATE — spawn self-checker + gap-detector + confluence checks
  2. SCORE — aggregate results into convergence score
  3. CHECK — all mandatory criteria pass?
     YES → exit SUCCESS
     NO  → continue
  4. ANALYZE — which criteria failed? what changed since last iteration?
  5. FIX — spawn fixer with specific findings
  6. RE-EVALUATE → go to step 1

  STAGNATION CHECK (per iteration):
    Same criteria failing for 3 iterations → STOP
    Score decreasing → STOP
    No diff between iterations → STOP
```

## Decision Framework

| Convergence | Action | Route |
|-------------|--------|-------|
| ≥ 90% AND 0 critical | **SUCCESS** — proceed to retrospective | retrospect → merge |
| 70–89% | **ITERATE** — spawn fixer for gaps | Continue loop |
| < 70% | **REDESIGN** — escalate to parliament | `parliament.amendment.proposed` |

## Exit Conditions

| Condition | Type | Action |
|-----------|------|--------|
| All mandatory criteria pass | SUCCESS | Output convergence report |
| Max iterations reached | PARTIAL | Output progress + remaining gaps |
| Same failure 3× consecutive | STAGNATION | Escalate to parliament |
| Score decreasing 2× consecutive | REGRESSION | Revert to best iteration |
| 0 diff between iterations | NO-PROGRESS | Stop, output diagnostic |

## Rules

- Max 5 iterations by default (configurable)
- Each iteration MUST produce measurable change
- Stagnation detection is mandatory — no infinite loops
- Fixer is spawned per iteration, not the implementer
- Convergence score must increase or the loop stops

## Anti-Patterns

- Do NOT run evaluation and fixing in the same context — spawn separate roles
- Do NOT continue after 3 identical failures — declare stagnation
- Do NOT bypass parliamentary gates
