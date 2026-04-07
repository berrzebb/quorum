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

## 빠른 시작

```bash
# Claude Code 플러그인으로 설치
claude plugin add berrzebb/quorum

# 프로젝트 초기화
quorum setup

# TUI 대시보드 시작
quorum daemon
```

---

## CLI

```bash
quorum setup                             # 프로젝트 초기화
quorum daemon                            # TUI 대시보드
quorum status                            # 게이트 상태
quorum parliament "논제"                  # 의회 심의 → CPS
quorum orchestrate plan <track>          # 대화형 기획
quorum orchestrate run <track>           # Wave 기반 실행
quorum orchestrate run <track> --resume  # 체크포인트에서 재개
quorum plan                              # 작업 분해 목록
quorum ask codex "..."                   # 프로바이더 직접 쿼리
quorum tool <name> [path] [options]      # MCP 도구 실행 (TOOLS.md 참조)
quorum verify                            # 전체 품질 검증
quorum verify CQ|T|TEST|SCOPE|SEC|LEAK|DEP  # 개별 검증
```

---

## 의회 (Parliament)

전략적 의사결정을 위한 입법 심의.

```bash
quorum parliament "결제 시스템 설계"               # 기본 심의
quorum parliament --rounds 3 "인증 설계"          # 다중 라운드 수렴
quorum parliament --mux "시스템 설계"             # daemon에서 관찰 가능
quorum parliament --history                       # 과거 세션 조회
quorum parliament --resume <id>                   # 심의 재개
```

5개 강제 게이트가 위반 시 작업을 차단:

| 게이트 | 차단 조건 | 우회 |
|--------|----------|------|
| Amendment | 미결 개정안 존재 | `--force` |
| Verdict | 최종 감사 ≠ approved | `--force` |
| Confluence | 합류 검증 실패 | `--force` |
| Design | 설계 산출물 미존재 | `--force` |
| Regression | Normal Form 단계 후퇴 | 경고만 |

---

## Wave 실행

```bash
quorum orchestrate plan <track> --provider claude   # 대화형 기획
quorum orchestrate run <track> --provider claude     # Wave 실행
quorum orchestrate run <track> --resume              # 장애 후 재개
```

- Phase 단위 게이트 (Phase N 완료 후 Phase N+1 진행)
- 같은 Wave 내 항목은 병렬 실행 (`--concurrency N`, 기본 3)
- 감사 실패 시 **Fixer** 에이전트가 수정 → 재감사
- `--resume`는 프로세스 충돌/재시작에서도 복원

### 병렬 플래너 (v0.6.5)

`quorum setup --agenda "<주제>" -y` 실행 시 3개 병렬 서브 에이전트로 기획:

| 단계 | 에이전트 | 출력 |
|------|---------|------|
| 1 | planner-prd | PRD.md, spec.md, blueprint.md, domain-model.md |
| 2a | planner-wb | work-breakdown.md (전용 에이전트) |
| 2b | planner-support | execution-order.md, test-strategy.md, work-catalog.md |

Phase 2는 Phase 1 완료 후 시작 (설계 문서가 존재해야 WB 생성 가능).

CLI 인자 분리:
- `-p <작업 프롬프트>` — user prompt
- `--append-system-prompt <시스템>` — system-level 지시
- `--output-format stream-json` — 데몬 캡처용 ndjson (mux 경로만)

---

## TUI 대시보드

`quorum daemon` — 4개 뷰, 고정 높이 레이아웃, Tab 네비게이션:

| 키 | 뷰 | 내용 |
|----|-----|------|
| 1 | Overview | GateStatus, AuditStream (스크롤), ParliamentPanel, TrackProgress |
| 2 | Review | FindingStats, OpenFindings, FileThreads |
| 3 | Chat | SessionList (↑↓ 탐색), TranscriptPane (ndjson→마크다운), Composer, GitExplorer |
| 4 | Operations | AgentPanel, FitnessPanel, LockPanel, SpecialistPanel, AgentQueryPanel |

Chat 뷰 기능:
- **에이전트 세션** — mux (psmux/tmux) + `.claude/agents/*.json` 자동 탐지
- **ndjson 파싱** — 줄바꿈 병합 (psmux 터미널 폭 보정)
- **리치 렌더링** — 마크다운, 도구 아이콘, thinking 블록, 접힌 그룹
- **양방향** — 트랜스크립트 스크롤, Composer로 에이전트에 입력 전송
- **Git 탐색** — 커밋 로그 (↑↓), 변경 파일, 커밋 상세

---

## 설정

`.claude/quorum/config.json`:

```jsonc
{
  "consensus": {
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

### 사용자 정의 훅

```jsonc
{
  "hooks": {
    "audit.submit": [
      { "name": "freeze-guard", "handler": { "type": "command", "command": "node scripts/check.mjs" } }
    ]
  }
}
```

---

## 어댑터

| 어댑터 | 훅 수 | 상태 |
|--------|-------|------|
| Claude Code | 21 이벤트 | 활성 |
| Gemini CLI | 11 이벤트 | 활성 |
| Codex CLI | 6 이벤트 | 활성 |
| OpenAI-compatible | 공유 | 활성 |

---

## consensus-loop 마이그레이션

```bash
quorum migrate            # 설정, 이력, 세션 상태 가져오기
quorum migrate --dry-run  # 변경 없이 미리보기
```

---

## 더 보기

- [도구 레퍼런스](TOOLS.md) — 22개 결정론적 MCP 도구
- [AI 에이전트 가이드](AI-GUIDE.md) — quorum 프로젝트에서 작업하는 AI 에이전트용
- [시스템 아키텍처](../../system/README.md) — 내부 설계, 철학, 컴포넌트 카탈로그
