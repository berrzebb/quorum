# Execution Order - Remote Autonomy v1

## Phase Graph

```text
Phase 0  Bridge foundation
  RAI-1 -> RAI-2

Phase 1  KAIROS kernel
  RAI-3 -> RAI-4

Phase 2  Cost envelope
  RAI-5 || RAI-6 || RAI-7

Phase 3  Operator surface
  RAI-8

Phase 4  Optional async channels
  RAI-9

Phase 5  Readiness review
  RAI-10
```

## Dependency View

- bridge chain:
  `RAI-1 → RAI-2 → RAI-8`
- autonomy chain:
  `RAI-1 → RAI-3 → RAI-4`
- cache envelope chain:
  `RAI-4 → RAI-5`
- content efficiency chain:
  `RAI-4 → RAI-6`
- file cache chain:
  `RAI-4 → RAI-7`
- async inbox chain:
  `RAI-1 → RAI-9`
- convergence:
  `RAI-5 + RAI-6 + RAI-7 + RAI-8 + RAI-9 → RAI-10`

## Parallelization Windows

| Window | Parallel Tasks | Why Safe | Merge Point |
|--------|----------------|----------|------------|
| W1 | `RAI-5` + `RAI-6` + `RAI-7` | prompt cache, content replacement, file cache는 모두 autonomy cost envelope이지만 write scope가 분리된다 | `RAI-10` |
| W2 | `RAI-8` + `RAI-9` | remote operator UI와 optional inbox는 bridge contract만 공유한다 | `RAI-10` |

## Serial-Only Zones

- `RAI-1 → RAI-2`
  - state stream contract가 먼저 있어야 remote approval callback을 올릴 수 있다.
- `RAI-3 → RAI-4`
  - idle scheduler가 먼저 있어야 safe job registry의 policy가 의미를 가진다.
- `RAI-4 → RAI-5/6/7`
  - 어떤 autonomy workload를 감쌀지 정해져야 cache/content/file envelope를 설계할 수 있다.
- `RAI-10`
  - bridge, approvals, autonomy, cost envelope 증거가 모두 모인 뒤에만 rollout 판단이 가능하다.

## Critical Path

`RAI-1 → RAI-2 → RAI-3 → RAI-4 → RAI-5 → RAI-8 → RAI-10`

이 경로가 critical path인 이유:

- `Bridge + KAIROS`의 핵심은 "원격 판단 + 안전한 자율 실행"이다.
- remote approval contract와 idle scheduler가 먼저 없다면 operator loop 자체가 성립하지 않는다.
- cache-safe autonomy context 없이 proactive loop를 켜는 건 비용 리스크가 커서 rollout 불가다.

## Phase Gates

### Gate A - Remote Control Safe ✅ PASSED

`RAI-1 + RAI-2` 완료 후 통과 조건 (모두 충족):

- ✅ remote state stream과 approval callback이 같은 state model을 사용한다. (RemoteSessionState → BridgeServer.snapshot() + ApprovalController.handleCallback())
- ✅ remote decision은 항상 gate/ledger를 통과한다. (ApprovalController → ledger.resolveApproval(), HMAC-SHA256 auth, replay protection)
- ✅ bridge offline이어도 local flow는 유지된다. (InMemorySessionLedger operates independently, 22 tests)

### Gate B - Autonomy Safe ✅ PASSED

`RAI-3 + RAI-4` 완료 후 통과 조건 (모두 충족):

- ✅ idle-only scheduler가 동작한다. (evaluateScheduler: 4-gate evaluation, shouldAbortJob: budget/state/approval checks)
- ✅ v1 proactive job는 safe allowlist에만 존재한다. (registerJob rejects mutatesSource=true, 4 built-in safe jobs)
- ✅ requires_action과 autonomy가 동시에 활성화되지 않는다. (pendingApprovalCount > 0 blocks scheduling, 23 tests)

### Gate C - Cost-Bounded ✅ PASSED

`RAI-5 + RAI-6 + RAI-7` 완료 후 통과 조건 (모두 충족):

- ✅ proactive fork가 cache-safe params를 재사용한다. (createCacheSafeParams + detectCacheBreak + telemetry)
- ✅ large output가 preview + artifact pointer로 대체된다. (processContent → replaceContent → fetchArtifact, retention enforced)
- ✅ repeated file read workload에 bounded cache가 적용된다. (FileStateCache LRU, mtime revalidation, configurable bounds, 21 tests)

### Gate D - Operator Ready ✅ PASSED

`RAI-8` 완료 후 통과 조건 (모두 충족):

- ✅ browser/mobile client가 pending approvals, latest digests, active jobs를 볼 수 있다. (projectStatusView + projectApprovalView + detectNotifications)
- ✅ remote status와 local daemon status가 의미적으로 동일하다. (same RemoteSessionState → StatusView/ApprovalView projection)

### Gate E - Rollout Ready ✅ PASSED

`RAI-10` 완료 후 통과 조건 (모두 충족):

- ✅ bridge auth/offline fallback이 문서화된다. (HMAC-SHA256 auth, fail-closed default, local ledger independent)
- ✅ autonomy와 remote approval이 함께 돌아도 safety/cost invariants를 깬 흔적이 없다. (requires_action blocks scheduler, cache envelope wraps jobs)
- ✅ optional inbox는 v1.1 or later로 분리 가능한 상태다. (SessionInbox independent module, async queue semantics, 18 tests)

**All 5 gates passed. RAI v1 plan complete. 3029 tests, 0 failures.**
