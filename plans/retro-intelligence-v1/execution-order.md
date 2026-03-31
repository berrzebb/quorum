# Execution Order - Retro Intelligence v1

## Phase Graph

```text
Phase 0  State and lock foundation
  RDI-1 || RDI-2

Phase 1  Deterministic dream engine
  RDI-3 -> RDI-4

Phase 2  Execution and handoff
  RDI-5 || RDI-6

Phase 3  Operator surface and optional upgrade
  RDI-7 || RDI-8

Phase 4  Readiness review
  RDI-9
```

## Dependency View

- trigger chain:
  `RDI-1 → RDI-5`
- lock chain:
  `RDI-1 → RDI-2 → RDI-5`
- deterministic engine chain:
  `RDI-1 + RDI-2 → RDI-3 → RDI-4`
- handoff chain:
  `RDI-4 → RDI-6`
- operator chain:
  `RDI-4 → RDI-7`
- optional upgrade chain:
  `RDI-4 → RDI-8`
- convergence:
  `RDI-5 + RDI-6 + RDI-7 + RDI-8 → RDI-9`

## Parallelization Windows

| Window | Parallel Tasks | Why Safe | Merge Point |
|--------|----------------|----------|------------|
| W0 | `RDI-1` + `RDI-2` | state split과 lock module은 맞물리지만 write scope를 분리해서 진행 가능하다 | `RDI-3`, `RDI-5` |
| W1 | `RDI-5` + `RDI-6` | execution surface와 next-wave consumption은 같은 digest contract만 공유한다 | `RDI-9` |
| W2 | `RDI-7` + `RDI-8` | daemon surfacing과 optional LLM upgrader는 deterministic digest 위에서 병렬 가능하다 | `RDI-9` |

## Serial-Only Zones

- `RDI-3 → RDI-4`
  - signal gathering contract가 먼저 고정되지 않으면 consolidate/prune 결과가 테스트 불가능해진다.
- `RDI-4 → RDI-6`
  - digest artifact shape가 먼저 있어야 handoff consumer를 wiring 할 수 있다.
- `RDI-9`
  - rollout 검토는 trigger, lock, handoff, daemon surfacing evidence가 모두 모인 뒤에만 의미가 있다.

## Critical Path

`RDI-1 → RDI-2 → RDI-3 → RDI-4 → RDI-5 → RDI-6 → RDI-9`

이 경로가 critical path인 이유:

- Dream의 가치 핵심은 "배운 걸 다음 wave에 넘기는 것"이다.
- 그래서 daemon polish보다 lock-safe deterministic digest와 handoff wiring이 먼저다.
- optional LLM upgrader는 ROI가 있지만, deterministic digest가 없이 먼저 갈 수는 없다.

## Phase Gates

### Gate A - Trigger Safe ✅ PASSED

`RDI-1 + RDI-2` 완료 후 통과 조건 (모두 충족):

- ✅ retro gate state와 consolidation state가 분리된다. (RetroState.retroPending ≠ RetroState.consolidationStatus, 20 tests pass)
- ✅ 3-gate trigger reason이 기록된다. (evaluateTrigger returns TriggerSnapshot with reason + gates[])
- ✅ lock는 stale reclaim 또는 rollback contract를 가진다. (reclaimStale + rollback, 23 tests pass)

### Gate B - Deterministic Digest Ready ✅ PASSED

`RDI-3 + RDI-4` 완료 후 통과 조건 (모두 충족):

- ✅ `Orient`, `Gather`, `Consolidate`, `Prune`가 deterministic engine으로 동작한다. (gatherSignals → consolidate → planPrune → generateDigest, 29 tests)
- ✅ `RetroDigest`와 prune journal이 동일 입력에서 재현 가능하다. (determinism test: consolidate(signals) === consolidate(signals))

### Gate C - Consumable Dream Ready ✅ PASSED

`RDI-5 + RDI-6` 완료 후 통과 조건 (모두 충족):

- ✅ manual/auto consolidation이 같은 engine을 사용한다. (runDream trigger=manual/wave-end/scheduled all use same pipeline)
- ✅ Dream failure가 retro gate release와 next-wave handoff를 막지 않는다. (failure returns {status:"failed"}, lock rollback, never throws)
- ✅ next-wave prompt가 digest-derived guidance를 받을 수 있다. (selectCarryover → retroCarryover → generateCompactSummary.nextConstraints + mergeRetroContext)

### Gate D - Rollout Ready ✅ PASSED

`RDI-9` 완료 후 통과 조건 (모두 충족):

- ✅ daemon이 consolidation status와 latest digest summary를 보여준다. (gates.ts Dream gate: status/detail/lastConsolidatedAt, snapshot.ts dream.* event detection)
- ✅ optional LLM path는 fallback invariant를 깨지 않는다. (upgradeDigest fallback on failure returns unchanged digest, 12 tests)
- ✅ stale lock recovery, prune journaling, handoff fallback이 문서화된다. (consolidation-lock.mjs reclaimStale/rollback, prune.mjs planPrune journaling, wave-compact.ts retroCarryover optional)

**All 4 gates passed. RDI v1 plan complete. 2945 tests, 0 failures.**
