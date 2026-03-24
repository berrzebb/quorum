# quorum — 플러그인 레퍼런스

> 상태: `active` | 패키지: `berrzebb/quorum`

크로스 모델 감사 게이트. 한 모델이 자기 코드를 승인할 수 없다.

편집 → 감사 → 합의 → 회고 → 커밋.

---

## 존재 이유

1. **독립 비평** — 작성하는 AI와 검토하는 AI를 분리. 동일 모델은 자신의 맹점을 잡지 못한다.
2. **합의 없이 전진 없음** — `[trigger_tag]` 항목은 `[agree_tag]`로 승격될 때까지 미완성.
3. **자동 회고** — 합의 완료 후 session-gate가 커밋을 차단. 회고 완료 후 해제.
4. **정책 = 데이터** — 감사 기준은 `references/` 파일에서 관리. 코드 변경 없이 조정.

---

## 감사 흐름

```
코드 편집 → PostToolUse 훅
    │
    ├─ [1] Regex 1차 스캔 (runPatternScan)
    │       → 후보 file:line 목록
    │
    ├─ [2] AST 2차 검증 (ast-analyzer)
    │       → false positive 제거 + 타입 정보 보강
    │       ※ 후보 있을 때만 실행, 없으면 skip
    │
    ├─ [3] 피트니스 점수 계산 (fitness.ts)
    │       → 7개 컴포넌트 → 0.0-1.0 단일 점수
    │
    ├─ [4] 피트니스 게이트 (fitness-loop.ts)
    │       ├─ auto-reject: 점수 급락 → LLM 감사 생략
    │       ├─ self-correct: 점수 소폭 하락 → 경고 후 진행
    │       └─ proceed: 점수 유지/개선 → 감사 진행
    │
    ├─ [5] 트리거 평가 (12팩터 점수, 피트니스 + blast radius + velocity + stagnation 포함)
    │       ├─ T1 스킵 (마이크로 변경)
    │       ├─ T2 단일 감사
    │       └─ T3 숙의 합의 (옹호 + 악마의 변호인 → 판사)
    │
    ├─ [6] 정체 감지 (5패턴, fitness-plateau 포함)
    │       → 에스컬레이션
    │
    ├─ [7] 감사 실행 (백그라운드)
    │       ↓
    │   판정 → 태그 동기화
    │       ↓
    │   ┌── [agree_tag] → 회고 게이트 → 커밋
    │   └── [pending_tag] → 보정 → 재제출
    │
    └─ [8] 품질 규칙 (eslint, tsc)
```

---

## CLI

```bash
quorum setup                          # 프로젝트 초기화
quorum daemon                         # TUI 대시보드
quorum status                         # 게이트 상태 (의회 포함)
quorum parliament "논제"              # 의회 심의 → CPS
quorum orchestrate plan <track>       # 대화형 기획 (소크라테스 + CPS)
quorum orchestrate run <track>        # 전체 구현 루프 (자동)
quorum plan                           # 작업 분해 목록
quorum ask codex "..."                # 프로바이더 직접 쿼리
quorum tool code_map                  # MCP 도구 실행
quorum tool blueprint_lint            # 네이밍 규칙 검증
```

---

## 의회 프로토콜 (Parliament)

입법 메타포를 활용한 구조적 합의: 논제 → 심의 → CPS → 설계 → PRD → WB → 감사.

```bash
quorum parliament "결제 시스템 설계"               # 기본 심의
quorum parliament --rounds 3 "인증 설계"          # 다중 라운드 수렴
quorum parliament --mux "시스템 설계"             # daemon에서 관찰 가능한 세션
quorum parliament --history                       # 과거 세션 조회
quorum parliament --resume <id>                   # 심의 재개
```

### 강제 게이트 (Enforcement Gates)

5개 구조적 게이트가 위반 시 **작업을 차단** (문서화가 아닌 코드 강제):

| 게이트 | 차단 조건 | 우회 |
|--------|----------|------|
| Amendment | 미결 개정안 존재 | `--force` |
| Verdict | 최종 감사 ≠ approved | `--force` |
| Confluence | 합류 검증 실패 | `--force` |
| Design | 설계 산출물 미존재 | `--force` |
| Regression | Normal Form 단계 후퇴 | 경고만 |

---

## consensus-loop에서 마이그레이션

기존 consensus-loop (v2.5.0) 사용자는 데이터를 quorum으로 가져올 수 있다:

```bash
quorum migrate            # config, 감사 이력, 세션 상태 가져오기
quorum migrate --dry-run  # 변경 없이 미리보기
```

| 데이터 | 출처 | 목적지 |
|--------|------|--------|
| 설정 | `.claude/consensus-loop/config.json` | `.claude/quorum/config.json` |
| 감사 이력 | `.claude/audit-history.jsonl` | SQLite EventStore |
| 세션 상태 | `.session-state/retro-marker.json` | 공유 위치 (변경 없음) |
| 증거 파일 | `docs/feedback/claude.md` | 변경 없음 |

---

## 숙의 합의 (T3)

| 라운드 | 역할 | 목적 |
|--------|------|------|
| 1 (병렬) | 옹호자 + 악마의 변호인 | 독립 분석 |
| 2 (순차) | 판사 | 양측 의견 기반 최종 판결 |

악마의 변호인 핵심 질문: **근본 원인을 해결했는가, 증상만 치료했는가?**

---

## 도메인 스페셜리스트

파일 패턴으로 도메인을 자동 감지하고, 도메인별 결정론적 도구 + LLM 에이전트를 조건적으로 활성화한다:

| 도메인 | 도구 | 에이전트 |
|--------|------|---------|
| perf | `perf_scan` | perf-analyst |
| a11y | `a11y_scan` | a11y-auditor |
| migration | `compat_check` | compat-reviewer |
| i18n | `i18n_validate` | i18n-checker |
| compliance | `license_scan` | compliance-officer |
| infra | `infra_scan` | infra-validator |
| observability | `observability_check` | observability-inspector |
| concurrency | — | concurrency-verifier |
| documentation | `doc_coverage` | doc-steward |

**21개 결정론적 도구** (`blueprint_lint` 포함) — 상세 문서는 [TOOLS.md](TOOLS.md) 참조.

### TUI 대시보드

데몬 TUI (`quorum daemon`)는 대시보드가 아닌 관제 센터:
- **GateStatus**: 실행 게이트 시각화 (Audit/Retro/Quality)
- **FitnessPanel**: 실시간 피트니스 점수 (7 컴포넌트), 스파크라인 이력, 게이트 결정
- **ParliamentPanel**: 실시간 심의 세션, 위원회 수렴 상태, 대기 개정안
- **AgentChatPanel**: 멀티패인 에이전트 대화 (선택, 핀, 입력, 전송)
- **AgentPanel**: 활성 에이전트 추적
- **TrackProgress**: 작업 분해 상태
- **AuditStream**: 실시간 이벤트 스트림

---

## 하이브리드 스캐닝

Regex 기반 패턴 스캔의 false positive 문제를 AST 분석으로 해결한다:

```
Regex 1차 스캔 (빠름, <1ms/파일)
    │
    ├─ scan-ignore 프라그마로 자기 참조 제거
    │
    └─ AST 2차 검증 (정밀, <50ms/파일)
        ├─ 주석/문자열 내부 매칭 → false positive 제거
        ├─ while(true) + break/return → safe-loop 다운그레이드
        └─ 타입 단언 컨텍스트 분석
```

**3층 방어**: scan-ignore(1차) → AST context filter(2차) → AST control flow(3차). 각 층이 독립적으로 fail-open.

**프로그램 모드** (`ts.createProgram()`): 크로스파일 분석 — 미사용 export 탐지, import 순환 감지 (DFS).

---

## 피트니스 점수 엔진

Karpathy의 autoresearch에서 영감: **측정 가능한 것은 LLM에게 묻지 않는다.**

| 컴포넌트 | 가중치 | 입력 |
|---------|--------|------|
| Type Safety | 0.20 | `as any` 수 / KLOC |
| Test Coverage | 0.20 | line + branch 커버리지 |
| Pattern Scan | 0.20 | HIGH findings 수 |
| Build Health | 0.15 | tsc + eslint 통과율 |
| Complexity | 0.10 | 평균 순환 복잡도 |
| Security | 0.10 | 보안 이슈 수 |
| Dependencies | 0.05 | 사용 중단 의존성 비율 |

**3단 게이트**:
- **auto-reject**: 점수 급락 (delta ≤ -0.15) 또는 절대 점수 < 0.3 → LLM 감사 생략 (비용 절감)
- **self-correct**: 소폭 하락 (-0.15 < delta ≤ -0.05) → 에이전트에게 경고
- **proceed**: 유지/개선 → 정상 진행, 개선 시 베이스라인 갱신

---

## 3-Layer 어댑터 패턴 (v0.4.4)

어댑터 간 비즈니스 로직 공유. I/O만 다르다:

| 계층 | 역할 | 위치 |
|------|------|------|
| **I/O** | stdin/stdout 파싱, 프로토콜 | `adapters/{adapter}/` |
| **비즈니스 로직** | 트리거, 증거, 훅, NDJSON | `adapters/shared/` (17+ 모듈) |
| **코어** | 감사, 21 MCP 도구, EventStore | `core/` |

새 어댑터 = I/O 래퍼 ~280줄 (Codex 어댑터).

### HookRunner 엔진

사용자 정의 훅. `config.json` 또는 `HOOK.md`에 작성:

```jsonc
{
  "hooks": {
    "audit.submit": [
      { "name": "freeze-guard", "handler": { "type": "command", "command": "node scripts/check.mjs" } }
    ]
  }
}
```

command/http 핸들러, 환경변수 보간 (`$VAR`), deny-first-break, 비동기 fire-and-forget, regex 매처.

### 멀티 모델 NDJSON 프로토콜

3개 CLI 런타임 → 통합 `AgentOutputMessage`:

| 런타임 | 포맷 | 어댑터 |
|--------|------|--------|
| Claude Code | `stream-json` | `ClaudeCliAdapter` |
| Codex | `exec --json` | `CodexCliAdapter` |
| Gemini | `stream-json` | `GeminiCliAdapter` |

`MuxAdapter`가 ProcessMux(tmux/psmux)를 연결해서 크로스 모델 합의에 사용.

---

## 프로바이더

| 프로바이더 | 메커니즘 | 훅 수 | 상태 |
|-----------|---------|-------|------|
| Claude Code | 네이티브 훅 | 22 | 활성 |
| Gemini CLI | 네이티브 훅 | 11 | 활성 |
| Codex CLI | 네이티브 훅 | 5 | 활성 |

---

## 설정

`.claude/quorum/config.json`:

```jsonc
{
  "consensus": {
    "watch_file": "docs/feedback/claude.md",
    "trigger_tag": "[REVIEW_NEEDED]",
    "agree_tag": "[APPROVED]",
    "pending_tag": "[CHANGES_REQUESTED]"
  },
  "hooks": {},
  "parliament": {
    "enabled": true,
    "convergenceThreshold": 2,
    "eligibleVoters": 3,
    "maxRounds": 10,
    "maxAutoAmendments": 5,
    "roles": { "advocate": "claude", "devil": "claude", "judge": "claude" }
  }
}
```
