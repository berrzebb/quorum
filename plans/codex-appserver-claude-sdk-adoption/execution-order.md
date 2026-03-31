# Execution Order - Claude Code Pattern Adoption / Provider Runtime Integration

## Phase Graph

```text
Phase 0  Baseline and adoption targets
  SDK-1 → SDK-2

Phase 1  Control-plane foundations from leaked code
  SDK-3 → SDK-4 → SDK-5 → SDK-6 → SDK-7 → SDK-8 → SDK-9

Phase 2  UI and observability consumption
  SDK-10 → SDK-11

Phase 3  Provider-native runtime wiring
  SDK-12 || SDK-13 → SDK-14 → SDK-15

Phase 4  Rollout and readiness
  SDK-16 → SDK-17
```

## Dependency View

- baseline chain:
  `SDK-1 → SDK-2`
- control-plane chain:
  `SDK-2 → SDK-3 → SDK-4 → SDK-5 → SDK-6 → SDK-7 → SDK-8 → SDK-9 → SDK-10 → SDK-11`
- provider wiring:
  `SDK-11 → SDK-12`
  `SDK-11 → SDK-13`
  `SDK-12 + SDK-13 → SDK-14 → SDK-15`
- rollout chain:
  `SDK-15 → SDK-16 → SDK-17`

## Parallelization Windows

| Window | Parallel Tasks | Why Safe | Merge Point |
|--------|----------------|----------|------------|
| W1 | `SDK-12` + `SDK-13` | Codex App Server와 Claude SDK는 provider-specific runtime wiring이 분리되지만, 공통 control plane은 이미 `SDK-11`에서 동결됨 | `SDK-14` |

## Serial-Only Zones

- `SDK-1 ~ SDK-11`
  - 이번 트랙의 핵심은 leaked-code pattern adoption이므로, capability registry/output cursor/compact/store가 먼저 고정되어야 한다.
- `SDK-14 ~ SDK-17`
  - provider event normalization 이후에는 today-applied surface wiring, config policy, readiness review가 같은 user-facing contract를 공유한다.

## Critical Path

`SDK-1 → SDK-2 → SDK-3 → SDK-4 → SDK-5 → SDK-6 → SDK-7 → SDK-8 → SDK-9 → SDK-10 → SDK-11 → SDK-12 → SDK-14 → SDK-15 → SDK-16 → SDK-17`

이 경로가 critical path인 이유:

- foundation 없이 provider transport를 붙이면 tool policy, output handling, context handoff가 다시 분산된다.
- leaked-code pattern adoption의 실질적 가치 대부분은 `SDK-5 ~ SDK-10`에서 나온다.
- Codex/Claude provider wiring은 foundation을 소비하는 단계이지, foundation을 정의하는 단계가 아니다.
- 오늘 추가된 `adversarial-review`, `harness mapping`, `stop gate`는 `SDK-15`에서 처음으로 새 control plane에 연결된다.

## Phase Gates

### Gate A - Control Plane Established ✅ PASSED

`SDK-9` 완료 후 통과 조건 (모두 충족):

- ✅ tool capability registry가 canonical source다. (`tool-capabilities.mjs`, 26 tools)
- ✅ deferred tool loading / role split가 동작한다. (`buildToolSurface()` + MCP filter)
- ✅ output cursor 기반 long-session read가 있다. (`output-tail.ts`, delta read)
- ✅ compact handoff + forked context가 있다. (`wave-compact.ts` + `context-fork.ts`)
- ✅ daemon session projection spine이 있다. (`daemon/state/store.ts`, selectors)
- ✅ design system primitives가 있다. (`Panel`, `StatusPill`, `SectionDivider`)

### Gate B - Runtime Wiring Converged

`SDK-15` 완료 후 통과 조건:

- Codex App Server와 Claude SDK가 같은 runtime model로 매핑된다.
- today-applied peer review / harness / stop gate surface가 새 runtime path를 사용한다.
- CLI fallback과 provider-native runtime이 같은 contract gate semantics를 지킨다.

### Gate C - Adoption Ready

`SDK-17` 완료 후 통과 조건:

- config/runtime selection policy가 문서화된다.
- production boundary와 optional dependency policy가 명시된다.
- build/test 회귀가 green이다.
- 구현 착수 시 "어떤 leaked-code 패턴을 어디에 어떻게 적용하는가"가 문서상 더 이상 모호하지 않다.
