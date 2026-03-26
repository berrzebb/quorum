# quorum AI 에이전트 가이드

> quorum이 설치된 프로젝트에서 AI 에이전트가 따라야 할 프로토콜.

## 역할 체인

| 역할 | 책임 | 모델 |
|------|------|------|
| **플래너** | 트랙 정의 + 실행 계획 조정 | Opus |
| **스카우트** | 읽기 전용 RTM 생성 (3방향 추적성 매트릭스) | Opus |
| **오케스트레이터** | 작업 분배 → 진행 추적 → 보정 → 머지 | 메인 세션 |
| **구현자** | 워크트리에서 구현 + 테스트 + 증거 제출 | Sonnet |
| **감사자** | 독립 검증 → 승인 또는 거절 판정 | GPT/Codex |

## 전체 사이클

```
플래너 → RTM 생성 → 오케스트레이터 → 스카우트 → 작업 분배
    ↓
┌─── 트랙 A (워크트리) ────────┐  ┌─── 트랙 B (워크트리) ────────┐
│  구현자: 코드 작성 + 테스트   │  │  구현자: 코드 작성 + 테스트   │
│  → 검증 (CQ/T/CC/CL/S)      │  │  → 검증                      │
│  → 증거 패키지 제출           │  │  → 증거 패키지 제출           │
│  → 감사 (트리거 평가)         │  │  → 감사                      │
│    T1: 스킵 (마이크로)        │  │    T3: 숙의 합의              │
│    T2: 단일 감사              │  │    옹호자+반대자→판사         │
│  → 판정 결과 수신             │  │  → 판정 결과 수신             │
└──────────────────────────────┘  └──────────────────────────────┘
    ↓
회고 프로토콜 (세션 게이트가 Bash/Agent 차단)
    → 잘한 점 / 개선할 점 / 메모리 업데이트
    → echo session-self-improvement-complete → 게이트 해제
    ↓
머지 → squash → 단일 커밋 → 다음 트랙 선택
```

## 트리거 평가

매 감사 전에 13개 팩터(12개 기본 + 상호작용 승수)의 점수를 합산하여 합의 모드를 결정한다:

| 팩터 | 가중치 | 설명 |
|------|--------|------|
| 변경 파일 수 | 0–0.3 | 1-2개면 낮음, 8개 이상이면 높음 |
| 보안 민감도 | 0–0.25 | auth/token/secret 등 보안 관련 패턴 포함 여부 |
| 이전 거절 횟수 | 0–0.2 | 같은 스코프에서 반복 거절 시 에스컬레이션 |
| API 표면 변경 | 0–0.15 | 공개 인터페이스(라우트, 타입)가 바뀌었는지 |
| 크로스 레이어 | 0–0.1 | 백엔드 + 프론트엔드가 동시에 변경되었는지 |
| 리버트 할인 | -0.3 | 롤백은 위험이 낮으므로 점수 차감 |
| 도메인 신호 | 0–0.1 | 전문가 도메인 감지됨 |
| 계획 문서 | 0–0.1 | 구조화된 계획 문서 존재 |
| 피트니스 점수 | 0–0.1 | FitnessLoop 품질 메트릭 |
| Blast radius | 0–0.15 | 전이적 영향 비율 > 10% |

점수에 따른 티어 배정:
- **< 0.3** → T1 스킵: 감사 불필요 (마이크로 변경)
- **0.3–0.7** → T2 단일 감사: 감사자 1명이 판정
- **> 0.7** → T3 숙의 합의: 3역할 프로토콜 실행

## 숙의 합의 프로토콜 (T3)

복잡한 변경에 대해 3역할이 2라운드에 걸쳐 판정한다:

**1라운드 (병렬 실행)**
- **옹호자**: 제출물의 장점을 찾는다. 테스트가 충분한지, 접근이 합리적인지 평가.
- **악마의 변호인**: 약점을 찾는다. 핵심 질문: *"이것이 근본 원인을 해결하는가, 아니면 증상만 치료하는가?"*

**2라운드 (순차 실행)**
- **판사**: 양측 의견을 검토하고 최종 판결을 내린다. 의견이 일치하면 확인, 불일치하면 더 강한 논거를 채택.

## 증거 패키지 형식

watch 파일에 **Write (전체 교체)**로 작성한다:

```markdown
## [trigger_tag] 작업 제목

### Claim
구체적으로 무엇을 했는지 서술. 클레임에 언급되지 않은 변경은 diff에 나타나면 안 된다.

### Changed Files

**코드**
- `src/경로/파일.ts` — 변경 내용 설명

**테스트**
- `tests/경로/파일.test.ts` — 테스트 추가/수정 내용

### Test Command
```bash
npx vitest run tests/특정파일.test.ts
npx eslint src/경로/파일.ts
npx tsc --noEmit
```

### Test Result
```
실제 터미널 출력을 그대로 붙여넣기.
요약 금지 — 감사자가 원본 출력을 직접 확인해야 한다.
```

### Residual Risk
알려진 미해결 항목. 공격자가 악용 가능하면 잔존 위험이 아니라 수정 대상이다.
해당 없으면 "없음" 기재.
```

## 절대 규칙

1. **`[trigger_tag]`만 사용** — `[Done]`, `[Partial]` 같은 비표준 라벨 금지. 감사자만 `[agree_tag]` 또는 `[pending_tag]` 적용.
2. **자기 승격 금지** — 자신의 코드에 `[agree_tag]`를 직접 적용할 수 없다. 이것이 정족수 원칙이다.
3. **테스트 명령은 그대로 재실행 가능** — 감사자가 복사해서 그대로 실행한다. 글로브 패턴 금지.
4. **Changed Files는 실제 diff와 일치** — diff에 있는데 증거에 없거나, 증거에 있는데 diff에 없으면 `scope-mismatch` 거절.

## 플래너 문서 체계

플래너 스킬은 10종의 설계 문서를 생성한다. 각 문서는 고정된 위치와 참조 가이드가 있다.

| 문서 | 수준 | 위치 | 용도 |
|------|------|------|------|
| **PRD** | 프로젝트 | `{planning_dir}/PRD.md` | 제품 요구사항 — 문제, 목표, 기능, 수락 기준 |
| **실행 순서** | 프로젝트 | `{planning_dir}/execution-order.md` | 트랙 의존성 그래프 — 어떤 트랙을 먼저 실행할지 |
| **작업 카탈로그** | 프로젝트 | `{planning_dir}/work-catalog.md` | 전 트랙의 모든 작업과 상태, 우선순위 |
| **ADR** | 프로젝트 | `{planning_dir}/adr/ADR-{NNN}.md` | 아키텍처 결정 기록 — "왜"를 기록 |
| **트랙 README** | 트랙 | `{planning_dir}/{track}/README.md` | 트랙 범위, 목표, 성공 기준, 제약 조건 |
| **작업 분해** | 트랙 | `{planning_dir}/{track}/work-breakdown.md` | 작업 분해 — `### [task-id]` 블록, depends_on/blocks |
| **API 계약** | 트랙 | `{planning_dir}/{track}/api-contract.md` | 엔드포인트 명세, 요청/응답 스키마, 인증 |
| **테스트 전략** | 트랙 | `{planning_dir}/{track}/test-strategy.md` | 테스트 계획 — 유닛/통합/E2E 범위, 커버리지 목표 |
| **UI 명세** | 트랙 | `{planning_dir}/{track}/ui-spec.md` | 컴포넌트 계층, 상태 (로딩/에러/빈/성공), 인터랙션 |
| **데이터 모델** | 트랙 | `{planning_dir}/{track}/data-model.md` | 엔티티 관계, 스키마, 마이그레이션, 인덱스 |

각 문서의 참조 가이드: `${CLAUDE_PLUGIN_ROOT}/skills/planner/references/`

## 결정론적 도구 (MCP)

LLM 추론 전에 결정론적 도구를 먼저 사용한다 — 사실을 먼저 수집하고, 추론은 그 다음이다:

| 도구 | 용도 | 사용자 |
|------|------|--------|
| `code_map` | 심볼 인덱스 (함수, 클래스, 타입, 줄 범위) | 스카우트, 구현자 |
| `dependency_graph` | Import/Export DAG, 위상 정렬, 순환 감지 | 스카우트, 오케스트레이터 |
| `audit_scan` | 패턴 스캐너 (타입 안전성, 하드코딩, console) | 구현자, 검증 |
| `coverage_map` | 파일별 커버리지 (vitest JSON 기반) | 검증, 구현자 |
| `rtm_parse` | RTM 마크다운 → 구조화된 행, req_id/status 필터 | 스카우트, 오케스트레이터 |
| `rtm_merge` | 워크트리 RTM 병합, 충돌 감지 | 오케스트레이터, 머지 |
| `audit_history` | 감사 이력 쿼리 — 판정 패턴, 위험 감지 | 오케스트레이터, 회고 |
| `perf_scan` | 성능 안티패턴 (O(n²), 동기 I/O, 무한 루프) | 구현자, 검증 |
| `a11y_scan` | 접근성 (alt 누락, 키보드 미지원, aria 오류) | 구현자 |
| `compat_check` | 호환성 (@deprecated, @breaking, CJS/ESM) | 구현자, 검증 |
| `license_scan` | 라이선스 + PII (copyleft, 시크릿, SSN) | 검증 |
| `infra_scan` | 인프라 보안 (Docker, CI/CD) | 검증 |
| `observability_check` | 관측성 (빈 catch, 구조화 로깅 누락) | 구현자 |
| `i18n_validate` | i18n 키 동기화 | 구현자 |
| `doc_coverage` | 문서-코드 정합성 (JSDoc 누락) | 검증 |
| `blast_radius` | 변경 파일의 전이적 영향 범위 (역방향 import BFS) | 오케스트레이터, 구현자 |
| `act_analyze` | PDCA Act 분석 (개선 항목 도출) | 회고 |
| `ai_guide` | AI 에이전트 가이드 쿼리 | 전 역할 |
| `audit_submit` | 증거를 SQLite EventStore에 제출 (watch_file 대체) | 구현자 |
| `agent_comm` | 에이전트 간 통신 (질문/응답/폴링) | 구현자 |
| `blueprint_lint` | 설계 단계 Blueprint 네이밍 규칙 검증 | 스카우트 |

CLI에서 직접 실행:
```bash
quorum tool code_map --root src/
quorum tool dependency_graph --root src/ --json
quorum tool blast_radius --changed_files '["core/bridge.mjs"]'
quorum tool audit_scan --pattern all
```

## 정체 감지

감사 루프가 진전 없이 순환하면 quorum이 자동으로 감지한다:

| 패턴 | 조건 | 권장 조치 |
|------|------|----------|
| **Spinning** | 같은 판정이 3회 이상 연속 반복 | 측면 사고 (다른 접근 시도) |
| **Oscillation** | 승인→거절→승인→거절 교대 | 작업 중단 + 재검토 |
| **No drift** | 동일 거절 코드가 계속 반복 | 상위 티어로 에스컬레이션 |
| **Diminishing returns** | 개선률이 단조 감소 | 상위 티어로 에스컬레이션 |
| **Fitness plateau** | 피트니스 점수 기울기 ≈ 0 (최근 N회) | 상위 티어로 에스컬레이션 |

## 의회 프로토콜 (Parliament)

`parliament.enabled` 설정 또는 `quorum parliament` CLI 사용 시:

1. **발산-수렴**: 3명의 의원이 자유 발언 → Judge가 4개 MECE 레지스터 + 5-분류(gap/strength/out/buy/build)로 수렴
2. **미팅 로그**: N회 세션 축적 → 3-경로 수렴 감지 (exact/no-new-items/relaxed) → CPS (Context-Problem-Solution) 생성
3. **개정안**: gap 분류에서 자동 발의; 과반수 투표 (구현자는 진술권만, 투표권 없음)
4. **강제 게이트**: 5개 게이트가 프로토콜 위반 시 작업 차단 (amendment/verdict/confluence/design/regression)
5. **Blueprint 린트**: `quorum tool blueprint_lint` — 설계 Blueprint의 네이밍 규칙 대비 소스 검증

`quorum parliament --history`로 과거 세션 조회. `--mux`로 daemon 관찰 가능한 심의 실행.

## 세션 게이트

감사 승인 후 회고가 완료될 때까지 도구를 제한한다:

| 상태 | 차단 도구 | 허용 도구 |
|------|----------|----------|
| 회고 진행 중 | Bash, Agent, git 관련 | Read, Write, Edit, Glob, Grep |
| 회고 완료 | — (전부 허용) | — |

게이트 해제: `echo session-self-improvement-complete`

## 거절 코드

| 코드 | 심각도 | 의미 |
|------|--------|------|
| `needs-evidence` | 중/경 | 증거 패키지 미흡 |
| `scope-mismatch` | **중** | 클레임과 코드 범위 불일치 |
| `lint-gap` | **중** | 린트 실패 |
| `test-gap` | **중** | 테스트 미흡/부재 |
| `claim-drift` | 경 | 증거가 코드 동작과 불일치 |
| `principle-drift` | 중/경 | SOLID/YAGNI/DRY 위반 |
| `security-drift` | **심각** | OWASP TOP 10 위반 |
| `regression` | **중** | 기존 테스트 깨짐 |
| `coverage-gap` | **중** | 커버리지 임계값 미달 |
