# quorum tools — 결정론적 분석 및 검증 도구

코드베이스 분석과 사전 감사 검증을 위한 내장 도구. 전부 결정론적 — LLM 관여 없음.

**원칙: 사실을 먼저 수집하고, 추론은 그 다음.**

---

## 사용법

```bash
quorum tool <이름> <경로> [옵션]
quorum tool <이름> --path <경로> [옵션]   # 명시적 형태
quorum tool <이름> --json                  # JSON 출력
```

---

## code_map

심볼 인덱스 — 함수, 클래스, 타입, import를 줄 번호와 함께 표시.

```bash
quorum tool code_map src/
quorum tool code_map src/agent/ --filter fn,class
quorum tool code_map src/bus/ --format matrix
```

| 옵션 | 설명 |
|------|------|
| `--path` | 스캔할 디렉토리 또는 파일 |
| `--filter` | 심볼 종류: `fn`, `class`, `type`, `import`, `iface` |
| `--depth` | 최대 디렉토리 깊이 |
| `--format` | `detail` (기본) 또는 `matrix` |

---

## dependency_graph

Import/Export DAG — 연결 컴포넌트, 위상 정렬, 순환 감지.

```bash
quorum tool dependency_graph .
quorum tool dependency_graph src/ --depth 2
quorum tool dependency_graph src/ --extensions .ts,.mjs
```

| 옵션 | 설명 |
|------|------|
| `--path` | 스캔할 디렉토리 |
| `--depth` | 최대 디렉토리 깊이 |
| `--extensions` | 포함할 확장자 (기본: `.ts,.mjs,.js`) |

---

## audit_scan

패턴 스캐너 — 타입 안전성 문제, 하드코딩 값, console 문 감지.

```bash
quorum tool audit_scan .
quorum tool audit_scan src/ --pattern type-safety
quorum tool audit_scan src/config/ --pattern hardcoded
```

| 옵션 | 설명 |
|------|------|
| `--path` | 스캔할 디렉토리 |
| `--pattern` | `all` (기본), `type-safety`, `hardcoded`, `console` |

---

## coverage_map

파일별 테스트 커버리지 (vitest JSON 리포트 기반).

```bash
quorum tool coverage_map
quorum tool coverage_map src/agent/
quorum tool coverage_map --coverage_dir coverage-report/
```

| 옵션 | 설명 |
|------|------|
| `--path` | 특정 디렉토리 필터 |
| `--coverage_dir` | 커버리지 리포트 디렉토리 (기본: `coverage/`) |

---

## rtm_parse

요구사항 추적 매트릭스(RTM) 마크다운을 구조화된 행으로 파싱.

```bash
quorum tool rtm_parse docs/rtm.md
quorum tool rtm_parse docs/rtm.md --matrix forward
quorum tool rtm_parse docs/rtm.md --req_id EV-1
quorum tool rtm_parse docs/rtm.md --status open
```

| 옵션 | 설명 |
|------|------|
| `--path` | RTM 마크다운 파일 |
| `--matrix` | `forward`, `backward`, `bidirectional` |
| `--req_id` | 요구사항 ID 필터 |
| `--status` | 상태 필터 (`open`, `verified`, `wip`) |

---

## rtm_merge

여러 워크트리 RTM을 기본 RTM에 병합 (충돌 감지 포함).

```bash
quorum tool rtm_merge --base docs/rtm.md --updates '["wt1/rtm.md","wt2/rtm.md"]'
```

| 옵션 | 설명 |
|------|------|
| `--base` | 기본 RTM 파일 |
| `--updates` | 워크트리 RTM 경로 JSON 배열 |

---

## audit_history

감사 판정 이력 로그 조회.

```bash
quorum tool audit_history
quorum tool audit_history --summary
quorum tool audit_history --track evaluation-pipeline
quorum tool audit_history --code CQ --since 2026-03-15T00:00:00Z
```

| 옵션 | 설명 |
|------|------|
| `--path` | JSONL 이력 파일 (기본: `.claude/audit-history.jsonl`) |
| `--track` | 트랙 이름 필터 |
| `--code` | 거절 코드 접두사 필터 |
| `--since` | ISO 타임스탬프 필터 |
| `--summary` | 집계 요약 표시 |

---

## fvm_generate

기능 검증 매트릭스 생성 — FE 라우트 × API 호출 × BE 엔드포인트 × 접근 정책.

```bash
quorum tool fvm_generate /path/to/project
quorum tool fvm_generate /path/to/project --format mismatches
```

| 옵션 | 설명 |
|------|------|
| `--path` | 프로젝트 루트 디렉토리 |
| `--format` | `full` (기본), `mismatches`, `matrix` |

---

## fvm_validate

FVM 행을 실제 서버에 실행하여 접근 정책 검증.

```bash
quorum tool fvm_validate \
  --fvm_path docs/fvm.md \
  --base_url http://localhost:3000 \
  --credentials '{"admin":{"username":"admin","password":"pass"}}'
```

| 옵션 | 설명 |
|------|------|
| `--fvm_path` | FVM 마크다운 파일 |
| `--base_url` | 테스트 대상 서버 URL |
| `--credentials` | JSON: 역할 → {username, password} 또는 {token} |
| `--filter_role` | 특정 역할만 테스트 |
| `--filter_route` | 특정 라우트만 테스트 |
| `--timeout_ms` | 요청 타임아웃 (기본: 5000) |

---

## 검증 파이프라인 (quorum verify)

모든 검사를 순차 실행. 각 검사는 결정론적.

```bash
quorum verify              # 전체 검사
quorum verify CQ           # 코드 품질 (eslint)
quorum verify T            # 타입스크립트 (tsc --noEmit)
quorum verify TEST         # 테스트 (npm test)
quorum verify SCOPE        # 스코프 매칭 (git diff vs 증거)
quorum verify SEC          # OWASP 보안 스캔 (10 패턴, semgrep 있으면 전환)
quorum verify LEAK         # 시크릿 탐지 (gitleaks 있으면 사용, 없으면 내장 패턴)
quorum verify DEP          # 의존성 취약점 (npm audit)
```

### 보안 스캔 (SEC)

OWASP Top 10 패턴 감지. semgrep이 설치되어 있으면 사용, 없으면 내장 regex.

| ID | 패턴 | 심각도 |
|----|------|--------|
| SEC-01 | SSRF (동적 URL fetch/http) | 심각 |
| SEC-02 | SQL 인젝션 (쿼리 내 문자열 보간) | 심각 |
| SEC-03 | XSS (innerHTML, dangerouslySetInnerHTML) | 높음 |
| SEC-04 | 경로 순회 (파일 연산에서 ../) | 심각 |
| SEC-05 | 하드코딩 시크릿 (password/token/key 할당) | 높음 |
| SEC-06 | 안전하지 않은 역직렬화 (신뢰할 수 없는 입력의 JSON.parse) | 높음 |
| SEC-07 | 커맨드 인젝션 (동적 exec/spawn) | 심각 |
| SEC-08 | 인증 누락 (미들웨어 없는 라우트 핸들러) | 중간 |
| SEC-09 | Eval 사용 (eval, new Function) | 심각 |
| SEC-10 | 민감 데이터 로깅 (console.log에 자격 증명) | 중간 |

### 시크릿 탐지 (LEAK)

git 스테이징 파일에서 유출된 자격 증명 스캔. **언어 무관**.

감지 패턴: AWS 키 (AKIA...), GitHub 토큰 (ghp_...), OpenAI 키 (sk-...), 프라이빗 키 (-----BEGIN), JWT (eyJ...).

`gitleaks`가 설치되어 있으면 git 히스토리까지 깊이 스캔.

### 의존성 감사 (DEP)

`npm audit`를 실행하고 critical/high 취약점 보고. 경고는 차단하지 않음 — critical만 실패.

### 스코프 매칭 (SCOPE)

`git diff --name-only`와 증거의 `### Changed Files` 섹션을 비교:
- diff에 있는데 증거에 없는 파일 (문서화되지 않은 변경)
- 증거에 있는데 diff에 없는 파일 (주장했지만 변경 안 됨)
