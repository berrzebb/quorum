# quorum 명령어 레퍼런스

> 모든 CLI 명령어의 구문, 플래그, 예제. 도구 레퍼런스는 [TOOLS.md](TOOLS.md), 워크플로 안내는 [USER-GUIDE.md](USER-GUIDE.md) 참조.

---

## 설정 및 상태

```bash
quorum setup                             # 프로젝트 초기화 (설정, 템플릿 복사)
quorum status                            # 게이트 상태 (감사, 회고, 품질, 의회)
quorum daemon                            # TUI 대시보드 (실시간 모니터링)
```

---

## 의회 (Parliament)

전략적 의사결정을 위한 입법 심의.

```bash
quorum parliament "논제"                  # 기본 심의 → CPS
quorum parliament --rounds 3 "논제"       # 다중 라운드 수렴
quorum parliament --mux "논제"            # daemon 관찰 가능 세션
quorum parliament --history              # 과거 세션 조회
quorum parliament --detail <id>          # 세션 상세
quorum parliament --resume <id>          # 심의 재개
quorum parliament --force "논제"          # 강제 게이트 우회
```

| 플래그 | 설명 |
|--------|------|
| `--rounds N` | 최대 심의 라운드 (기본: 설정값) |
| `--mux` | LLM 세션을 mux 패인으로 (daemon에서 관찰) |
| `--committee` | 특정 상임위 라우팅 |
| `--advocate` | 옹호자 프로바이더 재지정 |
| `--devil` | 악마의 변호인 프로바이더 재지정 |
| `--judge` | 판사 프로바이더 재지정 |
| `--testimony` | 구현자 진술 포함 |
| `--resume <id>` | 체크포인트에서 재개 |
| `--force` | 강제 게이트 우회 |

---

## 오케스트레이션

Wave 기반 작업 분해 기획 및 실행.

```bash
quorum orchestrate plan <track>                      # 대화형 기획 (소크라테스)
quorum orchestrate plan <track> --provider claude     # 프로바이더 지정
quorum orchestrate run <track>                        # Wave 실행
quorum orchestrate run <track> --provider claude      # 프로바이더 지정
quorum orchestrate run <track> --resume               # 체크포인트에서 재개
quorum orchestrate run <track> --concurrency 5        # Wave당 병렬 에이전트
```

| 플래그 | 설명 |
|--------|------|
| `--provider` | LLM 프로바이더 (claude, openai, codex, gemini) |
| `--concurrency N` | Wave당 최대 병렬 에이전트 (기본: 3) |
| `--resume` | 저장된 상태 로드, 완료된 Wave 건너뜀 |
| `--model` | 모델 선택 재지정 |

---

## 검증

결정론적 품질 검증 실행. 언어별 검증은 프로젝트 타입을 자동 감지.

```bash
quorum verify                            # 전체 검증
quorum verify CQ                         # 코드 품질 (린터)
quorum verify T                          # 타입 검사 (컴파일러)
quorum verify TEST                       # 테스트 (테스트 러너)
quorum verify SCOPE                      # 스코프 일치 (git diff vs 증거)
quorum verify SEC                        # OWASP 보안 스캔
quorum verify LEAK                       # 시크릿 탐지
quorum verify DEP                        # 의존성 취약점
```

| 검증 | JS/TS | Go | Python | Rust | Java |
|------|-------|-----|--------|------|------|
| CQ | eslint | golangci-lint | flake8/ruff | clippy | checkstyle |
| T | tsc --noEmit | go vet | mypy | cargo check | javac |
| TEST | npm test | go test | pytest | cargo test | mvn test |
| DEP | npm audit | govulncheck | pip-audit | cargo audit | mvn dependency-check |

> 현재 구현: JS/TS. 다른 언어는 `languages/` 레지스트리를 통한 패턴 스캐닝 사용.

---

## 도구

결정론적 MCP 분석 도구 실행.

```bash
quorum tool <이름> [경로] [옵션]           # 도구 실행
quorum tool <이름> --help                 # 도구별 도움말
quorum tool <이름> [경로] --json          # JSON 출력
```

22개 도구 상세는 [도구 레퍼런스](TOOLS.md) 참조.

---

## 유틸리티

```bash
quorum plan                              # 작업 분해 목록
quorum ask <provider> "프롬프트"           # 프로바이더 직접 쿼리
quorum migrate                           # consensus-loop에서 가져오기
quorum migrate --dry-run                 # 마이그레이션 미리보기
```

---

## 스킬 바로가기

| 바로가기 | 스킬 | 설명 |
|---------|------|------|
| `/quorum:cl-orch` | orchestrator | 작업 분배, 에이전트 관리 |
| `/quorum:cl-plan` | planner | PRD, 트랙, 작업 분해 설계 |
| `/quorum:cl-verify` | verify-implementation | 완료 기준 검증 |
| `/quorum:cl-docs` | doc-sync | 코드 사실 추출, 문서 불일치 수정 |
| `/quorum:cl-tools` | consensus-tools | 분석 도구 실행 |
| `/quorum:cl-retro` | retrospect | 교훈 추출, 메모리 관리 |
| `/quorum:cl-merge` | merge-worktree | 워크트리 squash-merge |
| `/quorum:cl-guide` | guide | 증거 작성 가이드 |
| `/quorum:consensus-audit` | audit | 수동 감사 실행 |
| `/quorum:consensus-status` | status | 게이트 상태 조회 |
