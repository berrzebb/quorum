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
    ├─ 트리거 평가 (6팩터 점수)
    │   ├─ T1 스킵 (마이크로 변경)
    │   ├─ T2 단일 감사
    │   └─ T3 숙의 합의 (옹호 + 악마의 변호인 → 판사)
    │
    ├─ 정체 감지 → 에스컬레이션
    │
    ├─ 감사 실행 (백그라운드)
    │       ↓
    │   판정 → 태그 동기화
    │       ↓
    │   ┌── [agree_tag] → 회고 게이트 → 커밋
    │   └── [pending_tag] → 보정 → 재제출
    │
    └─ 품질 규칙 (eslint, tsc)
```

---

## CLI

```bash
quorum setup              # 프로젝트 초기화
quorum daemon             # TUI 대시보드
quorum status             # 게이트 상태
quorum audit              # 수동 감사
quorum plan               # 작업 분해 목록
quorum ask codex "..."    # 프로바이더 직접 쿼리
quorum tool code_map      # MCP 도구 실행
quorum migrate            # consensus-loop 데이터 가져오기
```

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

## 프로바이더

| 프로바이더 | 메커니즘 | 상태 |
|-----------|---------|------|
| Claude Code | 12개 네이티브 훅 | 활성 |
| Codex | 파일 감시 + 상태 폴링 | 활성 |

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
  }
}
```
