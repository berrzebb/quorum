# quorum

[![npm](https://img.shields.io/npm/v/quorum-audit)](https://www.npmjs.com/package/quorum-audit)
[![CI](https://github.com/berrzebb/quorum/actions/workflows/ci.yml/badge.svg)](https://github.com/berrzebb/quorum/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)

크로스 모델 감사 게이트. 한 모델이 자기 코드를 승인할 수 없다.

```
편집 → 감사 → 합의 → 회고 → 커밋
```

<p align="center">
  <img src="assets/quorum-plan.png" width="600" alt="quorum plan — RTM 연동 트랙 진행률">
</p>

## 무엇을 하는가

quorum은 AI 에이전트 간의 합의 프로토콜을 강제합니다. 코드가 작성되면 독립적인 감사자가 증거를 검토합니다. 거절되면 수정 후 재제출. 합의에 도달해야만 커밋할 수 있습니다.

핵심 원칙: **한 모델이 코드를 작성하면서 동시에 승인할 수 없다.** 이것이 "정족수(quorum)" — 결정에 필요한 최소 독립 의견 수.

## 설치

### 독립 실행 (어떤 AI 도구든)

IDE 플러그인 없이 CLI만으로 동작합니다.

```bash
npm install -g quorum-audit    # 글로벌 설치
# 또는
npx quorum-audit setup         # 설치 없이 바로 실행

cd your-project
quorum setup                   # 설정 + MCP 서버 등록
quorum daemon                  # TUI 대시보드
```

**어떤 AI 도구와든** 사용 가능 — Claude Code, Codex, Gemini, 또는 수동.

### Claude Code 플러그인

편집할 때마다 자동으로 감사를 트리거하려면:

```bash
claude plugin marketplace add berrzebb/quorum
claude plugin install quorum@berrzebb-plugins
```

22개 라이프사이클 훅, 30개 MCP 도구, 29개 스킬, 13개 전문 에이전트가 자동 등록됩니다. CLI는 플러그인과 함께 동작합니다.

### Gemini CLI 확장

Gemini CLI에서 자동 훅 연동:

```bash
gemini extensions install https://github.com/berrzebb/quorum.git
# 또는 개발용:
gemini extensions link adapters/gemini
```

11개 훅, 33개 스킬, 4개 명령어, 30개 MCP 도구가 등록됩니다. Claude Code와 동일한 감사 엔진.

### Codex CLI 훅

OpenAI Codex CLI에서 자동 훅 연동:

```bash
# 프로젝트에 훅 설정 복사
cp platform/adapters/codex/hooks/hooks.json .codex/hooks.json
# 훅 기능 플래그 활성화
codex -c features.codex_hooks=true
```

5개 훅(SessionStart, Stop, UserPromptSubmit, AfterAgent, AfterToolUse)이 등록됩니다.

### 소스에서 빌드

```bash
git clone https://github.com/berrzebb/quorum.git
cd quorum && npm install && npm run build
npm link                       # 'quorum' 명령을 전역에서 사용
```

## CLI

```
quorum <command>

  setup          프로젝트 초기화
  interview      인터렉티브 요구사항 명확화
  daemon         TUI 대시보드
  status         감사 게이트 상태
  audit          수동 감사 트리거
  plan           작업 분해 + RTM 진행률
  orchestrate    트랙 선택, 에이전트 분배
  vault          지식 볼트 관리 (wiki/검색/그래프)              # v0.7.0
  steer          게이트 프로파일 전환                           # v0.6.5
  agent          에이전트 프로세스 관리 (spawn/list/capture/kill)
  ask <provider> 프로바이더 직접 쿼리
  tool <name>    MCP 분석 도구 실행
  verify         코드 품질 + 스코프 검증
  retro          회고 (감사 승인 후)
  merge          워크트리 squash merge
  migrate        consensus-loop 데이터 가져오기
  help           도움말
```

## consensus-loop에서 마이그레이션

기존 consensus-loop (v2.5.0) 사용자:

```bash
quorum migrate            # 설정, 감사 이력, 세션 상태 가져오기
quorum migrate --dry-run  # 미리보기
```

| 데이터 | 출처 | 목적지 |
|--------|------|--------|
| 설정 | `.claude/consensus-loop/config.json` | `.claude/quorum/config.json` |
| 감사 이력 | `.claude/audit-history.jsonl` | SQLite EventStore |
| 세션 상태 | `.session-state/retro-marker.json` | 공유 위치 (변경 없음) |
| 증거 제출 | `docs/feedback/claude.md` | `audit_submit` MCP tool → SQLite |

## 동작 방식

### 플러그인 없이 (독립 실행)

```
코드 작성
    → quorum audit              # 수동 트리거
    → 감사자 검토               # Codex, GPT, Claude 등
    → quorum status             # 판정 확인
    → 거절 시 수정 → 재제출
    → quorum daemon             # 실시간 TUI로 사이클 감시
```

### Claude Code 플러그인 (자동)

```
코드 작성
    → PostToolUse 훅 발화       # 자동
    → regex 스캔 + AST 정밀화  # 하이브리드: false positive 제거
    → 피트니스 점수 계산        # 7-컴포넌트 품질 메트릭
    → 피트니스 게이트           # 자동 거절 / 자가 수정 / 진행
    → 트리거 평가 (12팩터)     # T1 스킵, T2 단일, T3 숙의
    → 도메인 감지 + blast radius # 전문가 도구 활성화
    → 감사자 실행               # 백그라운드, 디바운스
    → 판정 동기화               # 태그 승격/강등
    → 세션 게이트               # 회고 완료까지 차단
    → 커밋 허용
```

## 아키텍처

```
quorum/
├── platform/             ← 모든 소스 코드 (7 레이어)
│   ├── cli/              ← 통합 진입점 (플러그인 없이 동작)
│   ├── orchestrate/      ← 5-레이어 오케스트레이션 (planning/execution/governance/state/core)
│   ├── bus/              ← EventStore (SQLite) + pub/sub + 정체 감지 + LockService + Claims + Parliament
│   ├── providers/        ← 합의 프로토콜 + 트리거 (13팩터) + 라우터 + 평가자 + AST 분석기
│   ├── core/             ← 감사 프로토콜 (7 모듈), 템플릿, MCP 도구 22개, 하네스 계약
│   ├── skills/           ← 36개 정규 스킬 정의 (프로토콜 중립)
│   └── adapters/
│       ├── shared/       ← 어댑터 공용 비즈니스 로직 (20 모듈: HookRunner, NDJSON, MuxAdapter 등)
│       ├── claude-code/  ← Claude Code 훅 (22) + 에이전트 (13) + 스킬 (29) + 명령어 (10)
│       ├── gemini/       ← Gemini CLI 훅 (11) + 스킬 (33) + 명령어 (4)
│       ├── codex/        ← Codex CLI 훅 (5) + 스킬 (33)
│       └── openai-compatible/ ← OpenAI 호환 에이전트 (13) + 스킬 (33)
├── daemon/               ← Ink TUI 대시보드 + FitnessPanel (독립 동작)
└── agents/knowledge/     ← 공유 에이전트 프로토콜 (구현자, 스카우트, 11 도메인)
```

`platform/adapters/` 계층은 **선택 사항**. 그 위의 모든 것은 독립적으로 동작합니다. 새 어댑터 추가 = I/O 래퍼만 작성 (~280줄, Codex가 증명).

## 핵심 개념

### 강제 게이트

진행을 차단하는 8가지 게이트 (문서가 아닌 코드가 강제):

| 게이트 | 차단 조건 | 해제 조건 |
|--------|----------|----------|
| **감사** | 증거 제출됨 | 감사자 승인 |
| **회고** | 감사 승인됨 | 회고 완료 |
| **품질** | 린트/테스트 실패 | 모든 검사 통과 |
| **수정안** | 미결 수정안 | 투표로 해결 |
| **판정** | 마지막 판정 ≠ 승인 | 재감사 통과 |
| **합류** | 무결성 검사 실패 | 4점 검증 통과 |
| **설계** | 설계 산출물 누락 | Spec + Blueprint 존재 |
| **회귀** | Normal Form 단계 후퇴 | 경고만 (비차단) |

### 숙의 합의 (Deliberative Consensus)

복잡한 변경(T3)에 대해 3역할 프로토콜:

1. **옹호자**: 제출물의 장점을 찾음
2. **악마의 변호인**: 가정에 도전, 근본 원인 vs 증상 치료 검증
3. **판사**: 양측 의견을 검토하고 최종 판결

### 도메인 전문의원 (v0.3.0)

변경이 특정 도메인에 해당하면, 전문 리뷰어가 조건부로 활성화됩니다:

| 도메인 | 도구 | 에이전트 | 최소 티어 |
|--------|------|----------|----------|
| 성능 | `perf_scan` | perf-analyst | T2 |
| 마이그레이션 | `compat_check` | compat-reviewer | T2 |
| 접근성 | `a11y_scan` | a11y-auditor | T2 |
| 컴플라이언스 | `license_scan` | compliance-officer | T2 |
| i18n | `i18n_validate` | — | T2 |
| 인프라 | `infra_scan` | — | T2 |
| 관측성 | `observability_check` | — | T3 |
| 문서화 | `doc_coverage` | — | T3 |
| 동시성 | — | concurrency-verifier | T3 |

도구는 결정론적 (비용 0, 항상 실행). 에이전트는 LLM 기반 (충분한 티어에서만 활성화).

### 하이브리드 스캐닝 (v0.3.0)

패턴 스캐닝의 3층 방어:

1. **Regex 1차 스캔** — 빠름 (<1ms/파일), 후보 탐지
2. **scan-ignore 프라그마** — `// scan-ignore`로 자기 참조 매칭 억제
3. **AST 2차 검증** — 정밀 (<50ms/파일), 주석/문자열 내부 매칭 제거, 제어 흐름 분석

**프로그램 모드** (`ts.createProgram()`): 크로스파일 분석 — 미사용 export 탐지, import 순환 감지.

### 피트니스 점수 엔진 (v0.4.0)

Karpathy의 autoresearch에서 영감: **측정 가능한 것은 LLM에게 묻지 않는다.**

| 컴포넌트 | 가중치 | 입력 |
|---------|--------|------|
| Type Safety | 0.20 | `as any` 수 / KLOC |
| Test Coverage | 0.20 | line + branch 커버리지 |
| Pattern Scan | 0.20 | HIGH findings 수 |
| Build Health | 0.15 | tsc + eslint 통과율 |
| Complexity | 0.10 | 평균 순환 복잡도 |
| Security | 0.10 | 취약점 findings |
| Dependencies | 0.05 | 취약/구버전 의존성 |

**FitnessLoop** 3단 게이트:
- **auto-reject**: 점수 급락 >0.15 또는 절대 <0.3 → LLM 감사 생략 (비용 절감)
- **self-correct**: 소폭 하락 (0.05–0.15) → 에이전트에게 경고
- **proceed**: 유지/개선 → 베이스라인 갱신, 감사 진행

### 조건부 트리거

모든 변경에 전체 합의가 필요하지는 않음. 13팩터 점수 시스템 (6 기본 + 도메인 + 계획 + 피트니스 + blast radius + velocity + stagnation + 상호작용 승수):

| 티어 | 점수 | 모드 |
|------|------|------|
| T1 | < 0.3 | 스킵 (마이크로 변경) |
| T2 | 0.3–0.7 | 단일 감사 |
| T3 | > 0.7 | 숙의 합의 (3역할) |

### 정체 감지

감사 루프가 진전 없이 순환하면 7가지 패턴 감지:

- **Spinning**: 같은 판정 3회 이상 반복
- **Oscillation**: 승인 → 거절 → 승인 → 거절
- **No drift**: 동일 거절 코드 반복
- **Diminishing returns**: 개선률 하락
- **Fitness plateau**: 피트니스 점수 기울기 ≈ 0 (최근 N회 평가)

### Blast Radius 분석 (v0.4.0)

역방향 import 그래프(inEdges)에서 BFS로 변경 파일의 전이적 의존자를 계산:

```bash
quorum tool blast_radius --changed_files '["platform/core/bridge.mjs"]'
# → 12/95 files affected (12.6%) — 깊이순 영향 목록
```

- **10번째 트리거 팩터**: ratio > 10% → 점수 += 최대 0.15 (자동 T3 에스컬레이션)
- **Pre-verify 증거**: blast radius 섹션이 감사자 증거에 포함

### 3-Layer 어댑터 패턴 (v0.4.2)

어댑터 간 비즈니스 로직 공유. I/O만 다르다:

```
I/O (platform/adapters/{adapter}/)
  Claude Code: hookSpecificOutput, permissionDecision
  Gemini CLI:  JSON-only stdout
  Codex CLI:   .codex/hooks.json
      ↓ readStdinJson() + withBridge()
Business Logic (platform/adapters/shared/ — 17 modules)
  hook-runner, trigger-runner, ndjson-parser,
  cli-adapter, mux-adapter, jsonrpc-client, ...
      ↓ bridge.init() + checkHookGate()
Core (platform/core/)
  audit, tools (28 MCP), EventStore, bus, vault
```

새 어댑터 추가: ~280줄 (Codex 어댑터 기준).

### HookRunner 엔진 (v0.4.2)

사용자 정의 훅. `config.json` 또는 `HOOK.md`에 작성:

```jsonc
{
  "hooks": {
    "audit.submit": [
      { "name": "freeze-guard", "handler": { "type": "command", "command": "node scripts/check-freeze.mjs" } }
    ]
  }
}
```

command/http 핸들러, 환경변수 보간 (`$VAR`), deny-first-break, 비동기 fire-and-forget, regex 매처 필터링.

### 멀티 모델 NDJSON 프로토콜 (v0.4.2)

3개 CLI 런타임의 출력을 통합 파싱:

| 런타임 | 포맷 | 어댑터 |
|--------|------|--------|
| Claude Code | `stream-json` | `ClaudeCliAdapter` |
| Codex | `exec --json` | `CodexCliAdapter` |
| Gemini | `stream-json` | `GeminiCliAdapter` |

모두 `AgentOutputMessage`로 변환. `MuxAdapter`가 ProcessMux(tmux/psmux) 세션을 연결해서 크로스 모델 합의에 쓴다.

### 동적 에스컬레이션

작업별 실패 이력 추적:

- 2연속 실패 → 상위 티어 승격
- 2연속 성공 → 하위 티어 강등
- Frontier 실패 → 정체 신호

### 플래너 문서

플래너 스킬이 생성하는 10종 설계 문서:

| 문서 | 수준 | 용도 |
|------|------|------|
| **PRD** | 프로젝트 | 제품 요구사항 — 문제, 목표, 기능, 수락 기준 |
| **실행 순서** | 프로젝트 | 트랙 의존성 그래프 |
| **작업 카탈로그** | 프로젝트 | 전 트랙 작업 상태 |
| **ADR** | 프로젝트 | 아키텍처 결정 기록 |
| **트랙 README** | 트랙 | 범위, 목표, 제약 |
| **작업 분해** | 트랙 | `### [task-id]` 블록 |
| **API 계약** | 트랙 | 엔드포인트 명세, 스키마 |
| **테스트 전략** | 트랙 | 유닛/통합/E2E 계획 |
| **UI 명세** | 트랙 | 컴포넌트, 상태, 인터랙션 |
| **데이터 모델** | 트랙 | 엔티티, 스키마, 마이그레이션 |

## 프로바이더

프로바이더 무관. 원하는 감사자를 사용.

| 프로바이더 | 메커니즘 | 훅 수 | 플러그인 필요? |
|-----------|---------|-------|-------------|
| Claude Code | 네이티브 훅 | 22 | 선택 (자동 트리거) |
| Gemini CLI | 네이티브 훅 | 11 | 선택 (`gemini extensions install`) |
| Codex CLI | 네이티브 훅 | 5 | 선택 (`.codex/hooks.json`) |
| 수동 | `quorum audit` | — | 아니오 |

## 도구

LLM 판단을 결정론적 사실로 대체하는 도구. 할루시네이션 불가.

**분석 도구** (19개):
```bash
# 핵심 분석
quorum tool code_map src/              # 심볼 인덱스
quorum tool dependency_graph .          # import DAG, 순환 감지
quorum tool blast_radius --changed_files '["platform/core/bridge.mjs"]'  # 전이적 영향 범위
quorum tool audit_scan src/             # 타입 안전성, 하드코딩 패턴
quorum tool coverage_map                # 파일별 테스트 커버리지
quorum tool audit_history --summary     # 감사 판정 패턴
quorum tool ai_guide                    # 컨텍스트 인식 온보딩

# RTM & 검증
quorum tool rtm_parse docs/rtm.md      # RTM 파싱
quorum tool rtm_merge --base a --updates '["b"]'  # 워크트리 RTM 병합
quorum tool fvm_generate /project       # FE×API×BE 접근 매트릭스
quorum tool fvm_validate --fvm_path x --base_url http://localhost:3000 --credentials '{}'

# 도메인 전문의원
quorum tool perf_scan src/             # 성능 안티패턴 (하이브리드: regex+AST)
quorum tool compat_check src/          # API 호환성 깨짐
quorum tool a11y_scan src/             # 접근성 (JSX/TSX)
quorum tool license_scan .             # 라이선스 + PII
quorum tool i18n_validate .            # 로케일 키 동등성
quorum tool infra_scan .               # Dockerfile/CI 보안
quorum tool observability_check src/   # 빈 catch, 로깅 갭
quorum tool doc_coverage src/          # JSDoc 커버리지 %
```

**검증 파이프라인** (`quorum verify`):
```bash
quorum verify              # 전체 검사
quorum verify CQ           # 코드 품질 (eslint)
quorum verify SEC          # OWASP 보안 (10 패턴, semgrep 있으면 전환)
quorum verify LEAK         # git 내 시크릿 (gitleaks 있으면 사용, 내장 fallback)
quorum verify DEP          # 의존성 취약점 (npm audit)
quorum verify SCOPE        # diff vs 증거 매칭
```

전체 레퍼런스: [docs/ko-KR/TOOLS.md](docs/ko-KR/TOOLS.md) | [docs/TOOLS.md](docs/TOOLS.md)

## 테스트

```bash
npm test                # 3030 tests
npm run typecheck       # TypeScript 검사
npm run build           # 컴파일
```

## CI/CD

태그 푸시 시 GitHub Actions가 크로스 플랫폼 바이너리 빌드:

```bash
git tag v0.5.0
git push origin v0.5.0
# → linux-x64, darwin-x64, darwin-arm64, win-x64 바이너리가 Releases에 올라감
```

## 라이선스

MIT
