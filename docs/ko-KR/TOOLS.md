# quorum tools — 결정론적 분석 도구

코드베이스 분석과 사전 감사 검증을 위한 내장 도구. 전부 결정론적 — LLM 관여 없음.

---

## 사용법

```bash
quorum tool <이름> <경로> [옵션]
quorum tool <이름> --help                    # 도구별 도움말
quorum tool <이름> <경로> --json             # JSON 출력
```

---

## code_map

심볼 인덱스 — 함수, 클래스, 타입, import를 줄 범위와 함께 표시.

```bash
quorum tool code_map src/
quorum tool code_map src/agent/ --filter fn,class
quorum tool code_map src/bus/ --format matrix
```

| 옵션 | 설명 |
|------|------|
| `--filter` | 심볼 타입: `fn`, `class`, `type`, `import`, `iface` |
| `--depth` | 최대 디렉토리 깊이 |
| `--format` | `detail` (기본) 또는 `matrix` |

---

## dependency_graph

Import/Export DAG — 연결 컴포넌트, 위상 정렬, 순환 감지.

```bash
quorum tool dependency_graph .
quorum tool dependency_graph src/ --depth 2
```

| 옵션 | 설명 |
|------|------|
| `--depth` | 최대 디렉토리 깊이 |
| `--extensions` | 파일 확장자 (기본: `.ts,.mjs,.js`) |

---

## blast_radius

변경 파일의 전이적 영향 범위 (역방향 import 그래프 BFS).

```bash
quorum tool blast_radius --changed_files '["platform/core/bridge.mjs"]'
quorum tool blast_radius --changed_files '["src/api.ts"]' --max_depth 5
```

| 옵션 | 설명 |
|------|------|
| `--changed_files` | 변경된 파일 JSON 배열 |
| `--max_depth` | BFS 깊이 제한 (기본: 10) |

---

## audit_scan

패턴 스캐너 — 타입 안전성, 하드코딩, console 문.

```bash
quorum tool audit_scan src/
quorum tool audit_scan src/ --pattern type-safety
```

| 옵션 | 설명 |
|------|------|
| `--pattern` | `all`, `type-safety`, `hardcoded`, `console` |

---

## coverage_map

vitest/jest JSON 리포트 기반 파일별 커버리지.

```bash
quorum tool coverage_map src/
```

---

## perf_scan

성능 안티패턴 — O(n²) 루프, 동기 I/O, 무한 루프, 무제한 쿼리.

```bash
quorum tool perf_scan src/
```

---

## a11y_scan

JSX/TSX 접근성 — alt 누락, 키보드 미지원 onClick, aria 이슈.

```bash
quorum tool a11y_scan src/components/
```

---

## compat_check

호환성 — @deprecated, @breaking, CJS/ESM 혼합, 와일드카드 의존성.

```bash
quorum tool compat_check src/
```

---

## license_scan

라이선스 위험 + PII 패턴 — copyleft, 하드코딩된 시크릿.

```bash
quorum tool license_scan .
```

---

## infra_scan

인프라 보안 — Dockerfile, CI/CD, docker-compose, nginx.

```bash
quorum tool infra_scan .
```

---

## observability_check

관측성 갭 — 빈 catch, console.log, 구조화 로깅 누락.

```bash
quorum tool observability_check src/
```

---

## i18n_validate

i18n 키 검증 — 크로스 로케일 동기화, 누락/여분 키.

```bash
quorum tool i18n_validate locales/
```

---

## doc_coverage

문서-코드 정합성 — 미문서 export, 파일별 JSDoc 커버리지.

```bash
quorum tool doc_coverage src/
```

---

## rtm_parse

RTM 마크다운을 구조화된 행으로 파싱.

```bash
quorum tool rtm_parse docs/rtm.md
quorum tool rtm_parse docs/rtm.md --matrix forward
quorum tool rtm_parse docs/rtm.md --req_id EV-1
```

| 옵션 | 설명 |
|------|------|
| `--matrix` | `forward`, `backward`, `bidirectional` |
| `--req_id` | 요구사항 ID 필터 |
| `--status` | 상태 필터: `open`, `verified`, `wip` |

---

## rtm_merge

워크트리 RTM을 기본 RTM에 병합 (충돌 감지 포함).

```bash
quorum tool rtm_merge --base docs/rtm.md --updates '["wt1/rtm.md","wt2/rtm.md"]'
```

---

## fvm_generate

Feature Verification Matrix — FE 라우트 × API × BE 엔드포인트 × 접근 정책.

```bash
quorum tool fvm_generate /path/to/project
quorum tool fvm_generate /path/to/project --format mismatches
```

| 옵션 | 설명 |
|------|------|
| `--format` | `full`, `mismatches`, `matrix` |

---

## fvm_validate

FVM 행을 실제 서버에서 실행하여 검증.

```bash
quorum tool fvm_validate --fvm_path docs/fvm.md --base_url http://localhost:3000 \
  --credentials '{"admin":{"token":"abc"}}'
```

| 옵션 | 설명 |
|------|------|
| `--fvm_path` | FVM 마크다운 파일 |
| `--base_url` | 서버 URL |
| `--credentials` | JSON: 역할 → {username, password} 또는 {token} |
| `--filter_role` | 특정 역할만 테스트 |
| `--filter_route` | 특정 라우트만 테스트 |

---

## audit_history

감사 판정 이력 조회.

```bash
quorum tool audit_history --summary
quorum tool audit_history --track evaluation-pipeline
quorum tool audit_history --code CQ --since 2026-03-15T00:00:00Z
```

| 옵션 | 설명 |
|------|------|
| `--track` | 트랙 이름 필터 |
| `--code` | 거절 코드 접두사 필터 |
| `--since` | ISO 타임스탬프 필터 |
| `--summary` | 집계 요약 |

---

## act_analyze

감사 이력 + FVM 결과로 개선 항목 도출.

```bash
quorum tool act_analyze
```

---

## blueprint_lint

설계 문서의 네이밍 규칙 대비 소스 코드 검증.

```bash
quorum tool blueprint_lint
quorum tool blueprint_lint --design_dir docs/design --path src/
```

---

## audit_submit

증거를 SQLite EventStore에 제출.

```bash
quorum tool audit_submit --content "## [REVIEW_NEEDED] Auth module\n### Claim\n..."
```

---

## agent_comm

병렬 구현을 위한 에이전트 간 통신.

```bash
quorum tool agent_comm --action post --agent_id impl-1 --to_agent impl-2 --question "스키마 준비됨?"
quorum tool agent_comm --action poll --agent_id impl-1
quorum tool agent_comm --action respond --agent_id impl-1 --query_id <id> --answer "완료."
```

---

## ai_guide

AI 에이전트 가이드 쿼리.

```bash
quorum tool ai_guide --topic evidence
quorum tool ai_guide --topic roles
```

---

## contract_drift

계약 드리프트 감지: 타입/인터페이스 재선언, 시그니처 불일치, 계약 디렉토리와 구현 간 누락 멤버. AST 프로그램 모드 사용.

```bash
quorum tool contract_drift
quorum tool contract_drift --contract_dirs types,interfaces
```

---

## skill_sync

정규 스킬(`platform/skills/`)과 어댑터 래퍼(`platform/adapters/*/skills/`) 간 불일치 감지 및 수정. 누락 래퍼, 오래된 참조, 개수 불일치 리포트.

```bash
quorum tool skill_sync
quorum tool skill_sync --fix
```

---

## track_archive

완료된 트랙 계획 산출물을 아카이브 디렉토리로 이동. WB, PRD, 설계, RTM 파일 포함.

```bash
quorum tool track_archive --track mytrack
quorum tool track_archive --track mytrack --dry_run
```

---

## 검증 파이프라인

```bash
quorum verify              # 전체 검증
quorum verify CQ           # eslint
quorum verify T            # tsc --noEmit
quorum verify TEST         # npm test
quorum verify SCOPE        # git diff와 증거 일치 확인
quorum verify SEC          # OWASP 보안 스캔
quorum verify LEAK         # 시크릿 탐지
quorum verify DEP          # 의존성 취약점
```

---

## scan-ignore

소스 라인에 `// scan-ignore`를 추가하면 해당 줄의 패턴 스캔 결과를 무시합니다.
