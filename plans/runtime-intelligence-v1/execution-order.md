# Execution Order - Runtime Intelligence v1

## Phase Graph

```text
Phase 0  Baseline and telemetry
  RTI-1A || RTI-1B || RTI-1C

Phase 1  Approval intelligence foundation
  RTI-2A -> RTI-2B -> RTI-2C

Phase 1  Transcript search foundation
  RTI-3A -> RTI-3B -> RTI-3C

Phase 2  Operator and context intelligence
  RTI-4 || RTI-5

Phase 3  Carryover and gate prediction
  RTI-6 || RTI-7

Phase 4  Controlled enforcement and perf evidence
  RTI-8 || RTI-9 || RTI-10

Phase 5  Readiness review
  RTI-11
```

## Dependency View

- baseline chain:
  `RTI-1A + RTI-1B + RTI-1C`
- approval chain:
  `RTI-1A → RTI-2A → RTI-2B → RTI-2C → RTI-8`
- transcript chain:
  `RTI-1C → RTI-3A → RTI-3B → RTI-3C → RTI-4 → RTI-10`
- compact chain:
  `RTI-1B → RTI-5 → RTI-6`
- speculation chain:
  `RTI-1A + RTI-1B + RTI-1C → RTI-7 → RTI-9`
- convergence:
  `RTI-8 + RTI-9 + RTI-10 → RTI-11`

## Parallelization Windows

| Window | Parallel Tasks | Why Safe | Merge Point |
|--------|----------------|----------|------------|
| W0 | `RTI-1A` + `RTI-1B` + `RTI-1C` | approval, compact, transcript telemetry는 write set이 거의 분리된다 | `RTI-2A`, `RTI-3A`, `RTI-5`, `RTI-7` |
| W1 | `RTI-2A` + `RTI-3A` | classifier pure logic와 visible-text contract는 서로 다른 계층을 건드린다 | `RTI-2B`, `RTI-3B` |
| W2 | `RTI-2C` + `RTI-3C` | provider approval wiring과 daemon search projection은 merge point가 분리돼 있다 | `RTI-4`, `RTI-8` |
| W3 | `RTI-4` + `RTI-5` | daemon search UI와 compact upgrader는 서로 다른 계층을 건드린다 | `RTI-6`, `RTI-10` |
| W4 | `RTI-6` + `RTI-7` | session memory와 speculation shadow는 둘 다 telemetry를 소비하지만 직접 충돌하지 않는다 | `RTI-9`, `RTI-11` |

## Serial-Only Zones

- `RTI-2A → RTI-2B → RTI-2C`
  - pure classifier, gate shadow wiring, provider contract 검증을 분리해야 false-allow 원인을 추적할 수 있다.
- `RTI-3A → RTI-3B → RTI-3C`
  - visible-text contract가 먼저 고정되지 않으면 index와 UI가 각자 다른 search semantics를 갖게 된다.
- `RTI-8 ~ RTI-11`
  - shadow에서 enforce로 넘어가는 단계이므로 contract와 benchmark evidence를 함께 묶어 검토해야 한다.

## Critical Path

`RTI-1A → RTI-2A → RTI-2B → RTI-2C → RTI-8 → RTI-11`

이 경로가 critical path인 이유:

- approval classifier는 가장 즉시 ROI가 큰 기능이자, 가장 위험한 기능이기도 하다.
- classifier가 shadow에서 enforce로 넘어가기 전 calibration evidence가 확보되어야 한다.
- readiness review는 classifier safety와 나머지 intelligence track의 fallback evidence가 모두 갖춰진 뒤에야 의미가 있다.

## Phase Gates

### Gate A - Telemetry Ready ✅ PASSED

`RTI-1A + RTI-1B + RTI-1C` 완료 후 통과 조건 (모두 충족):

- ✅ approval, compact, transcript, gate outcome에 대한 baseline metric이 수집된다. (ApprovalTelemetryRecord, CompactTelemetryRecord, GateProfileTelemetryRecord, TranscriptWorkloadMetrics)
- ✅ 이후 단계의 quality metric을 계산할 수 있다. (telemetryToInput() for replay, onTelemetry/onCompactTelemetry/onGateProfileTelemetry callbacks)

### Gate B - Approval And Search Foundations Ready ✅ PASSED

`RTI-2C + RTI-3C` 완료 후 통과 조건 (모두 충족):

- ✅ approval classifier shadow mode가 provider runtime 전체에 연결된다. (both Claude/Codex pass through classify() in process(), shadow invariant: gate unchanged)
- ✅ transcript index와 search state projection이 daemon consumer에 노출된다. (SearchStateProjection + nextSearchHit/prevSearchHit + TranscriptIndex.query())

### Gate C - Intelligence Shadow Ready ✅ PASSED

`RTI-5 + RTI-6 + RTI-7` 완료 후 통과 조건 (모두 충족):

- ✅ LLM compact가 deterministic fallback과 함께 동작한다. (generateCompactWithUpgrade() + CompactSummarizer interface + circuit breaker)
- ✅ session memory carryover가 bounded digest로 유지된다. (MemoryDigest maxEntries=5, addMemory() replaces lowest-importance)
- ✅ speculation predictor가 shadow recommendation과 calibration telemetry를 남긴다. (speculatePassLikelihood() enforce=false, onSpeculationTelemetry())

### Gate D - Controlled Rollout Ready ✅ PASSED

`RTI-11` 완료 후 통과 조건 (모두 충족):

- ✅ classifier enforce mode가 safe bucket에서만 켜진다. (shouldEnforce() + defaultEnforceConfig enabled=false + safety invariant check)
- ✅ fast lane은 calibration 기준을 충족한 low-risk path에서만 feature flag로 동작한다. (tryFastLane() requires enabled + minSamples=20 + precision>=0.85 + likelihood>=0.85)
- ✅ renderer benchmark 결과가 문서화되고 go/no-go가 기록된다. (runBenchmark() harness + G3 query latency test + extraction/indexing throughput metrics)

**All 4 gates passed. RTI v1 plan complete. 2849 tests, 0 failures.**
