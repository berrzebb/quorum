---
name: quorum:convergence-loop
description: "Evaluator-Optimizer loop adapted to quorum's parliamentary system. Iterates evaluate→fix→re-evaluate until fitness + confluence + amendment criteria converge. Max 5 iterations with stagnation detection. Single responsibility: convergence orchestration. Triggers on 'iterate', 'converge', 'auto-fix loop', '수렴', '반복 개선', '자동 수정', 'iterate until passing'."
argument-hint: "<track name> [--max-iterations N] [--threshold N]"
context: main
mergeResult: false
permissionMode: acceptEdits
memory: project
skills:
  - self-checker
  - gap-detector
  - fixer
tools:
  - read
  - write
  - glob
  - grep
  - bash
  - agent
hooks: {}
---

# Convergence Loop

Evaluator-Optimizer pattern for quorum's parliamentary system. Iterates through evaluate→fix→re-evaluate cycles until quality criteria converge. This is Normal Form convergence in action — each iteration moves closer to the canonical form.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | — | — |
| 2. Planning | — | — |
| 3. Design | — | — |
| 4. Implementation | — | — |
| 5. Verification | Spawns self-checker + gap-detector per iteration | orchestrates |
| 6. Audit | Spawns fixer on rejection | orchestrates |
| 7. **Convergence** | **Iterates evaluate→fix→re-evaluate until converged** | **✅ primary** |
| 8. Retrospective | Final convergence report feeds retrospective | downstream |

Operates at the end of the pipeline, orchestrating Phase 5–6 roles in a loop.

## Model Selection

Runs on **sonnet** — coordinates evaluation and fix roles, makes iteration/stop decisions.

## Convergence Criteria

Quality is measured across 3 dimensions, not just code metrics:

| Dimension | Components | Weight |
|-----------|-----------|--------|
| Fitness | 7-component quality score | 40% |
| Audit pass rate | CQ/T/CC/S/I + specialist findings | 40% |
| Parliamentary integrity | Confluence 4-point + Amendment resolution | 20% |

This goes beyond code quality — Law↔Code, Part↔Whole, Intent↔Result, Law↔Law must all pass.

## Input

- **Track name** or quality plan (from qa-strategist)
- **Quality criteria** — which checks must pass
- **Max iterations** — default 5, configurable

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
  6. RE-EVALUATE — go to step 1

  STAGNATION CHECK (per iteration):
    Same criteria failing for 3 iterations → STOP
    Score decreasing → STOP
    No diff between iterations → STOP
```

## Convergence Score

```
convergence = fitness(40%) + audit_pass_rate(40%) + confluence(20%)
```

| Component | Source | Weight |
|-----------|--------|--------|
| Fitness | fitness.ts — 7-component quality metric | 40% |
| Audit pass rate | Percentage of criteria passing | 40% |
| Confluence | confluence.ts — 4-point integrity check | 20% |

## Evaluator Delegation

Each iteration spawns evaluators based on which criteria failed:

| Failed Criterion | Evaluator | Model |
|-----------------|-----------|-------|
| CQ/T/CC/S/I | self-checker | haiku |
| Design↔Code gap | gap-detector | sonnet |
| Blueprint naming | `quorum tool blueprint_lint` | (tool) |
| Confluence | confluence verification | sonnet |
| Amendment | `quorum status` | (tool) |
| Fitness | fitness gate | (mechanical) |

## Iteration Control

### Decision Framework

Each iteration evaluates convergence score and routes:

| Convergence | Action | Route |
|-------------|--------|-------|
| ≥ 90% AND 0 critical | **SUCCESS** — proceed to retrospective | `quorum:retrospect` → `quorum:merge` |
| 70–89% | **ITERATE** — spawn fixer for remaining gaps | Continue loop |
| < 70% | **REDESIGN** — escalate to parliament | `parliament.amendment.proposed` → 3-role 심의 |

### Exit Conditions

| Condition | Type | Action |
|-----------|------|--------|
| All mandatory criteria pass | SUCCESS | Output convergence report |
| Max iterations reached | PARTIAL | Output progress report + remaining gaps |
| Same failure 3× consecutive | STAGNATION | Escalate to parliament (Amendment) |
| Score decreasing 2× consecutive | REGRESSION | Revert to best iteration via rollback |
| 0 diff between iterations | NO-PROGRESS | Stop, output diagnostic |

### Stagnation → Parliamentary Escalation

When stagnation is detected, **의회에 안건을 제안**한다:

| Stagnation Type | Amendment 내용 | 의회 행동 |
|----------------|---------------|----------|
| Spinning (동일 실패 3×) | 접근 변경 제안 (대안 2-3개) | Diverge-Converge → Judge 선택 |
| Regression (점수 하락) | 이전 최선 상태 복원 + 재설계 | Amendment 투표 |
| No-progress (diff 없음) | 범위 축소 or 수동 개입 | 3-role 심의 |
| Confluence 위반 | 법(설계) 수정 vs 코드 수정 | Amendment → 과반수 |

1. Record pattern in `auto-learn.ts` (feeds future trigger scoring)
2. Propose amendment via `parliament.amendment.proposed` event
3. If interactive → 의회 심의 결과를 사용자에게 제시
4. If headless → 자동 의회 심의 → 과반수 결정 → 실행

## Output

### Per-Iteration Progress

```
Iteration 2/5: auth-refactor

| Criterion | Iter 1 | Iter 2 | Status |
|-----------|--------|--------|--------|
| CQ | ❌ 3 violations | ✅ 0 | FIXED |
| T | ⚠️ 10/12 tests | ✅ 12/12 | FIXED |
| CC | ✅ | ✅ | PASS |
| Confluence | ❌ Law↔Code mismatch | ❌ still | PENDING |
| Fitness | 0.72 | 0.78 | IMPROVING |

Convergence: 65% → 78% (+13%)
Spawning fixer for: Confluence Law↔Code mismatch
```

### Final Report

```
Convergence Complete: auth-refactor

| Iteration | Fitness | Pass Rate | Confluence | Score |
|-----------|---------|-----------|------------|-------|
| 1 | 0.72 | 60% | 50% | 65% |
| 2 | 0.78 | 80% | 50% | 78% |
| 3 | 0.85 | 100% | 100% | 93% |

Result: SUCCESS (3 iterations)
Normal Form stage: Manual Fix → Normal Form (100%)
```

## Rules

- Max 5 iterations by default (configurable via `--max-iterations`)
- Each iteration MUST produce measurable change — no empty loops
- Stagnation detection is mandatory — no infinite loops
- Fixer is spawned per iteration, not the implementer (fixes are surgical)
- Convergence score must increase or the loop stops

## Anti-Patterns

- Do NOT run evaluation and fixing in the same context — spawn separate roles
- Do NOT skip confluence checks for Tier 3 tracks
- Do NOT continue after 3 identical failures — declare stagnation
- Do NOT bypass parliamentary gates (Amendment, Verdict, Confluence)
