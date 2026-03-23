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

**어떤 AI 도구와든** 사용 가능 — Claude Code, Codex, Cursor, Gemini, 또는 수동.

### Claude Code 플러그인

편집할 때마다 자동으로 감사를 트리거하려면:

```bash
claude plugin install quorum
```

12개 라이프사이클 훅이 등록됩니다. CLI는 플러그인과 함께 동작합니다.

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
| 증거 파일 | `docs/feedback/claude.md` | 변경 없음 |

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
    → 트리거 평가 (T1/T2/T3)   # 스킵, 단일, 숙의
    → 감사자 실행               # 백그라운드, 디바운스
    → 판정 동기화               # 태그 승격/강등
    → 세션 게이트               # 회고 완료까지 차단
    → 커밋 허용
```

## 아키텍처

```
quorum/
├── cli/          ← 통합 진입점 (플러그인 없이 동작)
├── daemon/       ← Ink TUI 대시보드 (독립 동작)
├── bus/          ← EventStore (SQLite) + pub/sub + 정체 감지 + LockService + ProcessMux
├── providers/    ← 합의 프로토콜 + 트리거 + 라우터 + 도메인 전문의원 + 에이전트 로더
├── core/         ← 감사 프로토콜 (7 모듈), 템플릿, MCP 도구 17개
└── adapters/     ← 선택적 IDE 통합 (Claude Code 훅, Codex 감시자)
```

`adapters/` 계층은 **선택 사항**. 그 위의 모든 것은 독립적으로 동작합니다.

## 핵심 개념

### 강제 게이트

진행을 차단하는 세 가지 게이트:

| 게이트 | 차단 조건 | 해제 조건 |
|--------|----------|----------|
| **감사** | 증거 제출됨 | 감사자 승인 |
| **회고** | 감사 승인됨 | 회고 완료 |
| **품질** | 린트/테스트 실패 | 모든 검사 통과 |

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

### 조건부 트리거

모든 변경에 전체 합의가 필요하지는 않음. 12팩터 점수 시스템 (6 기본 + 도메인 신호):

| 티어 | 점수 | 모드 |
|------|------|------|
| T1 | < 0.3 | 스킵 (마이크로 변경) |
| T2 | 0.3–0.7 | 단일 감사 |
| T3 | > 0.7 | 숙의 합의 (3역할) |

### 정체 감지

감사 루프가 진전 없이 순환하면 4가지 패턴 감지:

- **Spinning**: 같은 판정 3회 이상 반복
- **Oscillation**: 승인 → 거절 → 승인 → 거절
- **No drift**: 동일 거절 코드 반복
- **Diminishing returns**: 개선률 하락

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

| 프로바이더 | 메커니즘 | 플러그인 필요? |
|-----------|---------|-------------|
| Claude Code | 12개 네이티브 훅 | 선택 (자동 트리거) |
| Codex | 파일 감시 + 상태 폴링 | 아니오 |
| Cursor | — | 예정 |
| Gemini | — | 예정 |
| 수동 | `quorum audit` | 아니오 |

## 도구

LLM 판단을 결정론적 사실로 대체하는 도구. 할루시네이션 불가.

**분석 도구** (17개):
```bash
# 핵심 분석
quorum tool code_map src/              # 심볼 인덱스
quorum tool dependency_graph .          # import DAG, 순환 감지
quorum tool audit_scan src/             # 타입 안전성, 하드코딩 패턴
quorum tool coverage_map                # 파일별 테스트 커버리지
quorum tool audit_history --summary     # 감사 판정 패턴

# RTM & 검증
quorum tool rtm_parse docs/rtm.md      # RTM 파싱
quorum tool rtm_merge --base a --updates '["b"]'  # 워크트리 RTM 병합
quorum tool fvm_generate /project       # FE×API×BE 접근 매트릭스
quorum tool fvm_validate --fvm_path x --base_url http://localhost:3000 --credentials '{}'

# 도메인 전문의원 (v0.3.0)
quorum tool perf_scan src/             # 성능 안티패턴
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

전체 레퍼런스: [docs/ko/TOOLS.md](docs/ko/TOOLS.md) | [docs/en/TOOLS.md](docs/en/TOOLS.md)

## 테스트

```bash
npm test                # 533 tests
npm run typecheck       # TypeScript 검사
npm run build           # 컴파일
```

## CI/CD

태그 푸시 시 GitHub Actions가 크로스 플랫폼 바이너리 빌드:

```bash
git tag v0.2.2
git push origin v0.2.2
# → linux-x64, darwin-x64, darwin-arm64, win-x64 바이너리가 Releases에 올라감
```

## 라이선스

MIT
