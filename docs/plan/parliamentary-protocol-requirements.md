# Parliamentary Protocol Requirements

quorum 의회 의사규칙 (Rules of Procedure) 종합 요구사항.

## 1. Vision

### 1.1 궁극적 목표

**구조적으로 실수를 할 수 없게 하는 것.**

누가 와도 동일한 코드를 찍어낼 수 있도록, 의회가 법률을 제정함으로써 코드의 멱등성을 소유한다.

```
impl(A, law) = impl(B, law) = impl(C, law)
```

### 1.2 성공 지표: Normal Form 수렴

어떤 구현자(Claude, Codex, Gemini)든 시작점의 Structural Conformance가 다르더라도, 의회 절차를 거치면 **100% Normal Form**으로 수렴한다.

```
Raw Output → Autofix → Manual Fix → Normal Form (100%)
```

quorum의 가치 = Raw Output 품질을 올리는 것이 아니라, **어떤 Raw Output이든 Normal Form으로 수렴시키는 구조**를 소유하는 것.

### 1.3 설계 판단 기준

모든 설계 결정에서 이 질문을 던진다:

> "이 설계가 구현자의 주관적 판단을 줄이는가, 늘리는가?"

줄이면 채택. 늘리면 재고.

---

## 2. 의회 구성

### 2.1 참석자 (의원)

| 역할 | 권한 | 책임 |
|------|------|------|
| **Advocate** | 의결권 | 장점 발견, 승인 근거 제시 |
| **Devil's Advocate** | 의결권 | 약점 발견, 거부 근거 제시 |
| **Judge** | 의결권 | 양측 종합, 최종 판결 |
| **Specialist** | 의결권 (도메인 한정) | 도메인 전문 의견 (조건부 소집) |
| **Implementer** | **진술권만** (투표 불가) | 구현 의도/기각 대안/제약/불확실 지점 설명 |

### 2.2 의결 요건

- **과반수 동의** 필요 (의결권자 중)
- 구현자는 의결에 참여하지 않음

### 2.3 발언 규칙

**발언 무제한 원칙**: 역할이 발언을 제한하지 않는다.
- Advocate도 리스크를 말할 수 있다
- Devil도 장점을 인정할 수 있다
- 구현자도 자유롭게 진술한다
- 하고 싶은 말을 편하게 한다

---

## 3. 입법 절차 (Legislative Process)

### 3.1 전체 흐름

```
미팅 (N회 축적, 발산→수렴)
    ↓ 수렴 판정
기획 (CPS: Context → Problem → Solution)
    ↓ Gap + Build만 필터
법률 제정 (PRD)
    ↓
Design (Spec → Blueprint → Domain Model → Architecture)
    ↓
플래닝 (WB 생성)
    ↓
구현 (법률에 따른 집행)
    ↓
감사 (Audit — 개별 법률 준수 검증)
    ↓
합류 검증 (Confluence Verification — 전체 정합성)
    ↓
완료 (또는 개정안 발의 → 의회로 복귀)
```

### 3.2 입법-사법 대응표

| 의회 용어 | quorum 프로토콜 |
|----------|---------------|
| 의회 토론 | 미팅 (발산) |
| 회의록 | 미팅 로그 |
| 법안 발의 요건 | 수렴 판정 |
| 법안 초안 | CPS (Context-Problem-Solution) |
| 법률 확정 | PRD |
| 시행령 | Design (Spec/Blueprint/Domain Model/Architecture) |
| 시행규칙 | WB (Work Breakdown) |
| 법 집행 | 구현 |
| 사법 심사 | Audit (개별 준수) + Confluence (전체 정합) |
| 법률 개정 | Amendment (과반수 동의) |

---

## 4. Phase 1: 미팅 (의회 토론)

### 4.1 미팅 사이클

- 주 2~3일 × 하루 2회 = **주당 4~6회** consensus 세션
- **AM** (출근 직후): Plan + Check — 오늘 목표 설정 + 전회 결과 리뷰
- **PM** (퇴근 직전): Check + Act — 오늘 결과 리뷰 + 변경 반영

### 4.2 미팅 3원칙

1. **발산 → 수렴 → 미팅 로그**: 자유 발산 → 4개 MECE 레지스터로 수렴 → 미팅 로그 작성
2. **5분류 분석**: 로그 항목을 MECE 분류
3. **발언 무제한**: 역할이 발언을 제한하지 않음

### 4.3 심의 프로토콜 (Diverge-Converge)

```
Phase A: 발산 (Diverge)
  전원 무제한 발언 — 역할 무관하게 의견 제시

Phase B: 수렴 (Converge)
  4개 MECE 레지스터로 구조화:
  ① 상태 변동  → handoff 업데이트
  ② 의사결정   → ADR / Decision Log
  ③ 요구사항 변동 → PRD 반영
  ④ 리스크     → FDE 체크리스트

Phase C: 5분류 분석
  ① Gap       (부족한 것)       → 신규 WB 도출
  ② Strength  (잘된 것)        → 패턴으로 기록
  ③ Out       (불필요한 것)     → scope에서 제거
  ④ Buy       (직접 안 만들 것) → 의존성으로 등록
  ⑤ Build     (직접 만들 것)    → WB로 배정
```

### 4.4 미팅 로그 축적과 수렴

- 미팅 로그는 수렴될 때까지 **N회 반복 축적**
- 수렴 판정 기준: 5분류가 N회 연속 변동 없음, 또는 참여자 합의
- 수렴 전까지는 발산 반복 허용
- 관계: **미팅 로그 N개 (다) → 1개 CPS (1) → 1개 PRD (1)**

### 4.5 Session Digest

매 consensus 라운드 후 4개 레지스터 통합 출력 자동 생성. 이전 라운드 출력이 다음 라운드 입력으로 체인됨.

---

## 5. Phase 2: 기획 (CPS)

### 5.1 입력

미팅 5분류에서 **Gap + Build만** 필터. Strength/Out/Buy는 기획 대상이 아님 (자연스러운 scope 통제).

### 5.2 CPS 프레임

```markdown
## Context (맥락)
현재 상황이 어떠한가. 누가, 어떤 환경에서, 무엇을 하고 있는가.
→ 축적된 미팅 로그의 상태 변동/맥락 종합에서 도출

## Problem (문제)
그 맥락에서 무엇이 안 되는가. 왜 지금 해결해야 하는가.
→ Gap 항목 종합에서 도출

## Solution (솔루션)
어떻게 해결할 것인가. 만들 것인가 / 연동할 것인가 / 변경할 것인가.
→ Build 항목 종합에서 도출
```

### 5.3 CPS → PRD 매핑

| CPS | PRD |
|-----|-----|
| Context | §1. Problem & Background |
| Problem | §2. Goals & Success Metrics |
| Solution | §4. Tracks & Requirements (FR/NFR) |

---

## 6. Phase 3: 법률 제정 (PRD)

기존 Planner 프로토콜에 따라 PRD 작성. CPS가 Phase 2의 **구조화된 입력**으로 투입됨.

### 6.1 MECE 분해 (Phase 1.5)

PRD 작성 전, Intent를 구조적으로 분해:

1. **Actor 분해** (ME — 역할 중복 없음): 모든 이해관계자 식별
2. **System 분해** (ME — 시스템 경계 명확): Actor별 필요 시스템 도출
3. **Domain Coverage** (CE — 횡단 관심사 누락 없음): Security, Persistence, Error Handling, Observability, i18n, Accessibility 등

### 6.2 FDE 체크리스트 (Phase 5.5)

DRM 확정 후 WB 작성 전, 각 FR별 실패 시나리오 분석:

| 실패 시나리오 | 영향도 | 대응 전략 | WB 필요? |
|-------------|:------:|----------|:-------:|
| (식별된 실패) | H/M/L | (대응 방법) | ✓/✗ |

→ 실패 대응에서 누락된 WB 자동 도출

---

## 7. Phase 4: Design (시행령)

PRD 확정 후 "어떻게 만드는가"를 정의하는 4개 산출물:

| 산출물 | 내용 | 역할 |
|--------|------|------|
| **Spec** | FR/NFR → 기술 명세 변환 | "무엇을" 기술적으로 |
| **Blueprint** | 모듈/인터페이스/계약 | 구현 청사진 |
| **Domain Model** | 핵심 도메인 객체와 관계 | 비즈니스 모델 |
| **Architecture** | 시스템 구성과 데이터 흐름 | 전체 구조 |

Design이 확정되면 WB 생성으로 진행.

---

## 8. Phase 5: 구현 (법 집행)

### 8.1 구현 결정론

의회에서 제정된 법률(6개 안건의 의결 결과)이 구현의 **모든 주관적 판단을 대체**.

- 법률이 모든 주관적 분기점을 사전 제거
- 구현자가 누구든, 몇 번이든, 언제든 **동일 결과 산출 (멱등성)**
- 구현자 역할 = "설계+구현"이 아니라 **"법률에 따른 집행"**

### 8.2 법률 구속 범위

| 법률 출처 | 구속 대상 | 예시 |
|----------|----------|------|
| ① Principles | 모든 산출물 | "Audit Trail 없는 기능 불가" |
| ② Definitions | 네이밍/용어 | "`Restaurants`로 통일" |
| ③ Structure | 계층/관계 | "Agent는 SubAgent를 통해 호출" |
| ④ Architecture | 데이터 흐름 | "모든 통신은 MessageBus 경유" |
| ⑤ Scope | 구현 범위 | "SMS 알림은 Out Scope" |

---

## 9. Phase 6: 감사 (Audit) + 합류 검증 (Confluence Verification)

### 9.1 Audit (사법 심사 — 부분 정합성)

개별 법률 준수 여부 검증. "이 코드가 법률 §X를 따르는가?"

### 9.2 Confluence Verification (합류 검증 — 전체 정합성)

설계 → 구현 → Audit **이후** 수행. 4가지 합류 검증:

| 합류 지점 | 질문 | 불일치 시 |
|----------|------|----------|
| **Law ↔ Code** | 법률과 코드가 일치하는가? | Audit에서 선행 검증 |
| **Part ↔ Whole** | 모듈 통합 시 동작하는가? | 통합 테스트 실패 → 수정 |
| **Intent ↔ Result** | CPS Problem이 실제 해결되었는가? | 요구사항 미충족 → 개정안 발의 |
| **Law ↔ Law** | 서로 다른 법률이 모순되지 않는가? | 법률 개정 필요 |

불일치 발견 시 **개정안 발의 → 의회로 복귀**.

---

## 10. 상설 안건 (Standing Committees)

6개 안건이 상임위원회처럼 상시 존재. **순서 고정 아님** — 필요할 때 선택되어 논의됨.

| 안건 | 범주 | 세부 항목 |
|------|------|----------|
| **① Principles** | 원칙 | I/O Boundaries, User Mental Model, No Hallucination, HITL, Audit Trail |
| **② Definitions** | 정의 | Agent Examples, Agent Call, Sub Agent, Context |
| **③ Structure** | 구조 | Hierarchy, Relation |
| **④ Architecture** | 설계 | Overview, Dataflow |
| **⑤ Scope** | 범위 | In Scope, Out Scope |
| **⑥ Research Questions** | 연구 | 요구사항, 통신 프로토콜, Intent Classification, Agent 협력, State Management, Workflow Visualization |

- 한 미팅에서 복수 안건 논의 가능
- 각 안건별로 독립적 수렴 추적
- 각 안건은 독립적으로 미팅 로그 축적 → 수렴 → CPS → PRD 사이클을 거침

---

## 11. 법률 개정 (Amendment)

- 모든 단계(Design/플래닝/구현/심의/미팅)에서 **개정안 발의 가능**
- 개정도 제정과 **동일한 입법 절차**를 거침
- 개정 시 **과반수 동의** 필요
- Amendment Log로 추적:

| ID | 대상 | 변경 | 발의자 | 근거 | 의결 |
|----|------|------|--------|------|------|
| A-001 | (법률/Design/PRD) | (변경 내용) | (역할) | (사유) | 승인/보류/거부 |

---

## 12. FDE/MECE 기반 시스템 강화

### 12.1 FDE 피드백 루프

| 항목 | 내용 |
|------|------|
| Stagnation → Trigger learning | oscillation/spinning → trigger score 자동 가산 |
| Post-merge fitness validation | 머지 후 fitness 하락 > 0.1 → verdict 무효화 |
| Router lateral movement | T3 2회 실패 → 도메인 전문가 전환 |
| Confidence-weighted voting | Judge가 confidence 가중 반영 |

### 12.2 MECE 갭 해소

| 항목 | 내용 |
|------|------|
| Security 도메인 추가 | auth, crypto, jwt, session (9→10개) |
| Event 택소노미 정리 | audit.escalate/downgrade/retry 추가 |
| Fitness 축 확장 | security, dependency health, API stability |
| Stagnation expansion | verdict 악화 패턴 감지 |

---

## 13. Normal Form 수렴 단계 매핑

```
Raw Output    = 구현자가 법률 참조 없이 산출한 코드
Autofix       = Audit에서 법률 위반 자동 교정
Manual Fix    = Confluence Verification에서 합류 불일치 수정
Normal Form   = 법률에 완전히 적합한 최종 형태 (멱등성 달성, 100%)
```

---

## 부록: 구현 상태

**전량 구현 완료** (20/20 WB, 2026-03-25).

| 우선순위 | 범위 | 상태 |
|---------|------|:----:|
| **P0** | Security 도메인 + FDE 피드백 루프 기본 구조 | ✅ 완료 |
| **P1** | Event 택소노미 + Planner MECE/FDE (Phase 1.5, 5.5) | ✅ 완료 |
| **P2** | Diverge-Converge 심의 + Session Digest + 구현자 진술권 + CPS 기획 + 상설 안건 + Design 4산출물 + 법률 개정 + 구현 결정론 + Confluence Verification + Normal Form 수렴 | ✅ 완료 |

커밋: `a4b29c9` (P0~P1 + P2 일부), `80163b2` (PP-20 Normal Form)
