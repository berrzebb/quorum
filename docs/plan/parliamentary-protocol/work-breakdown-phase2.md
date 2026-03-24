# Work Breakdown Phase 2: Parliamentary Protocol Integration

PP-1~PP-20(모듈 구현) 완료 후, 모듈 간 통합 + 테스트 + 미구현 항목 해소.

## Working Principles

- 테스트 먼저 — 신규 모듈 테스트 없이 통합하지 않음
- bridge 경유 — 모든 외부 접근은 bridge.mjs를 통해
- 세션 오케스트레이터가 흐름을 관장 — 개별 모듈 직접 호출 금지

## Tracks

```
Track A (Testing):        PI-1, PI-2, PI-3, PI-4     ← 병렬 가능
Track B (Integration):    PI-5 → PI-6 → PI-7         ← Track A 이후
Track C (Enhancement):    PI-8, PI-9, PI-10           ← PI-5 이후, 병렬 가능
```

```
PI-1 ──┐
PI-2 ──┤
PI-3 ──┼── PI-5 ── PI-6 ── PI-7
PI-4 ──┘     │
             ├── PI-8
             ├── PI-9
             └── PI-10
```

---

## Track A: Testing (병렬)

### PI-1: Meeting Log + CPS 테스트

- **Goal**: meeting-log.ts의 핵심 함수 런타임 검증
- **Size**: S (~80줄)
- **First touch files**:
  - `tests/meeting-log.test.mjs` — **신규**
- **Tests**:
  - `createMeetingLog()` — 올바른 구조 생성
  - `storeMeetingLog()` + `getMeetingLogs()` — EventStore 왕복
  - `checkConvergence()` — 2회 연속 안정 시 수렴 판정
  - `checkConvergence()` — 변동 시 미수렴
  - `generateCPS()` — Gap+Build만 CPS에 포함, Strength/Out/Buy 제외
  - `STANDING_COMMITTEES` — 6개 상수 존재 확인
  - `computeConvergenceScore()` — 엔트로피 기반 점수 0.0-1.0
- **Done**: `node --test tests/meeting-log.test.mjs` passes with 7+ test cases

### PI-2: Amendment 테스트

- **Goal**: amendment.ts의 발의/투표/의결 런타임 검증
- **Size**: S (~70줄)
- **First touch files**:
  - `tests/amendment.test.mjs` — **신규**
- **Tests**:
  - `proposeAmendment()` — EventStore에 이벤트 저장
  - `voteOnAmendment()` — voting role 투표 성공
  - `voteOnAmendment()` — implementer 투표 거부
  - `resolveAmendment()` — 과반수 찬성 → approved
  - `resolveAmendment()` — 과반수 반대 → rejected
  - `resolveAmendment()` — 미달 → deferred
  - `getAmendments()` — 전체 조회 + 투표 그룹핑
- **Done**: `node --test tests/amendment.test.mjs` passes with 7+ test cases

### PI-3: Confluence Verification 테스트

- **Goal**: confluence.ts의 4가지 합류 검증 런타임 검증
- **Size**: S (~60줄)
- **First touch files**:
  - `tests/confluence.test.mjs` — **신규**
- **Tests**:
  - `checkLawCode` — audit approved → passed
  - `checkLawCode` — changes_requested → failed
  - `checkPartWhole` — integration tests passed/failed
  - `checkIntentResult` — CPS gaps 있으면 warning
  - `checkLawLaw` — contradictions → error
  - `verifyConfluence()` — 전체 통과 / 부분 실패 시 suggestedAmendments 생성
- **Done**: `node --test tests/confluence.test.mjs` passes with 6+ test cases

### PI-4: Normal Form 테스트

- **Goal**: normal-form.ts의 수렴 추적 런타임 검증
- **Size**: S (~60줄)
- **First touch files**:
  - `tests/normal-form.test.mjs` — **신규**
- **Tests**:
  - `classifyStage()` — 라운드 0 → raw-output, 1-2 → autofix, 3+ → manual-fix, approved+confluence → normal-form
  - `computeConformance()` — 가중 합산 검증
  - `trackProviderConvergence()` — EventStore에서 provider별 추적
  - `generateConvergenceReport()` — 다중 provider 리포트
  - `estimateRawConformance()` — 첫 verdict 기반 추정
- **Done**: `node --test tests/normal-form.test.mjs` passes with 5+ test cases

---

## Track B: Integration (순차)

### PI-5: Parliament Session Orchestrator

- **Goal**: 의회 세션 전체 흐름을 관장하는 오케스트레이터 모듈
- **Prerequisite**: PI-1, PI-2, PI-3, PI-4
- **Size**: M (~250줄)
- **First touch files**:
  - `bus/parliament-session.ts` — **신규**
- **Implementation**:
  - `ParliamentSession` 클래스: 세션 생성 → 심의(diverge-converge) → 미팅 로그 기록 → 수렴 판정 → CPS 생성 → 개정안 확인 → confluence 검증 → normal-form 추적
  - `startSession()`: parliament.session.start 이벤트 발행, AM/PM 판별
  - `runDeliberation()`: consensus.runDivergeConverge() 호출 → verdict + registers + classifications 수신
  - `recordAndCheckConvergence()`: meeting-log 저장 → checkConvergence()
  - `resolveAmendments()`: 대기 중 개정안 의결
  - `verifyConfluence()`: confluence.verifyConfluence() 호출
  - `trackNormalForm()`: normal-form.trackProviderConvergence() 호출
  - `endSession()`: parliament.session.digest 이벤트 발행
- **Tests**:
  - Unit: `tests/parliament-session.test.mjs` — 전체 세션 흐름 (mock auditor)
- **Done**: 세션 시작→심의→기록→수렴→검증→종료 전체 흐름 동작

### PI-6: Bridge Integration

- **Goal**: core/bridge.mjs에서 parliament 모듈 노출
- **Prerequisite**: PI-5
- **Size**: S (~80줄)
- **First touch files**:
  - `core/bridge.mjs` — parliament 함수 노출 추가
  - `bus/index.ts` — 새 모듈 re-export
- **Implementation**:
  - `bridge.startParliamentSession()` → ParliamentSession.startSession()
  - `bridge.checkConvergence()` → meeting-log.checkConvergence()
  - `bridge.proposeAmendment()` → amendment.proposeAmendment()
  - `bridge.verifyConfluence()` → confluence.verifyConfluence()
  - `bridge.getConvergenceReport()` → normal-form.generateConvergenceReport()
  - fail-safe wrapping (기존 bridge 패턴 준수)
- **Tests**:
  - Unit: `tests/bridge.test.mjs` — 기존 테스트 + parliament 함수 추가
- **Done**: bridge 경유 호출 동작, 기존 bridge 테스트 통과

### PI-7: Hook Wiring

- **Goal**: adapter hook에서 parliament 세션 자동 트리거
- **Prerequisite**: PI-6
- **Size**: S (~60줄)
- **First touch files**:
  - `adapters/claude-code/index.mjs` — T3 deliberative 시 diverge-converge 경로 추가
  - `adapters/shared/trigger-runner.mjs` — parliament mode 플래그
- **Implementation**:
  - PostToolUse에서 trigger 결과가 T3이고 config에 `parliament.enabled: true`이면 → `bridge.startParliamentSession()` 호출
  - 기존 T3 deliberative 경로는 fallback으로 유지 (parliament 비활성 시)
  - config.json에 `parliament` 섹션 추가: `{ enabled: boolean, convergenceThreshold: number }`
- **Tests**:
  - Integration: parliament 활성 시 diverge-converge 경로, 비활성 시 기존 경로
- **Done**: hook에서 parliament 세션 자동 트리거, config로 on/off 가능

---

## Track C: Enhancement (병렬, PI-5 이후)

### PI-8: Confidence-Weighted Voting

- **Goal**: Judge가 Advocate/Devil의 confidence를 가중 반영
- **Prerequisite**: PI-5
- **Size**: S (~60줄)
- **First touch files**:
  - `providers/consensus.ts` — converge judge 프롬프트 + 파싱 수정
- **Implementation**:
  - Judge 프롬프트에 "higher confidence opinion should carry more weight" 추가
  - parseDivergeOpinion에서 confidence 추출 강화
  - verdict 결정 시 confidence-weighted majority 로직 추가 (현재는 동일 비중)
- **Tests**:
  - Unit: confidence 차이가 verdict에 영향 미치는지 검증
- **Done**: 높은 confidence 의견이 결과에 더 큰 영향

### PI-9: Router Lateral Movement

- **Goal**: T3에서 반복 실패 시 에스컬레이션 대신 도메인 전문가 전환
- **Prerequisite**: PI-5
- **Size**: S (~100줄)
- **First touch files**:
  - `providers/router.ts` — lateral 경로 추가
  - `bus/stagnation.ts` — lateral 추천 시 도메인 제안
- **Implementation**:
  - Router에 `lateral()` 메서드: T3 + 2회 실패 + stagnation.recommendation === "lateral" → 도메인 전문가 전환
  - Stagnation의 "lateral" 추천에 활성 도메인 정보 첨부
  - Router 상태에 `lateralAttempts` 카운터 추가 (무한 lateral 방지)
- **Tests**:
  - Unit: T3 + 2회 실패 → lateral 전환 검증
  - Unit: lateral 3회 초과 → halt
- **Done**: lateral 경로 동작, 무한 루프 방지

### PI-10: Committee Auto-Routing

- **Goal**: 미팅 토픽을 자동으로 적절한 상설 안건에 라우팅
- **Prerequisite**: PI-5
- **Size**: S (~80줄)
- **First touch files**:
  - `bus/meeting-log.ts` — 라우팅 함수 추가
- **Implementation**:
  - `routeToCommittee()`: 토픽 키워드 → 상설 안건 매핑
    - "auth", "permission", "boundary" → principles
    - "agent", "sub-agent", "context" → definitions
    - "hierarchy", "relation", "parent" → structure
    - "dataflow", "api", "protocol" → architecture
    - "scope", "in/out", "exclude" → scope
    - 나머지 → research-questions
  - 키워드 매칭은 domain-detect.ts와 같은 regex 패턴 방식
  - 복수 안건 매칭 가능 (한 토픽 → 여러 안건)
- **Tests**:
  - Unit: 키워드별 라우팅 검증
- **Done**: 토픽 → 안건 자동 라우팅 동작

---

## Summary

| Track | WB | 유형 | 크기 | 병렬 |
|-------|-----|------|:----:|:----:|
| A Testing | PI-1~4 | 테스트 | S | ✓ |
| B Integration | PI-5~7 | 코드 | S~M | 순차 |
| C Enhancement | PI-8~10 | 코드 | S | ✓ (PI-5 이후) |

**총 10개 WB** / 테스트 4개 + 통합 3개 + 개선 3개
