# Work Breakdown Phase 3: Parliamentary Protocol Operationalization

Phase 1(모듈 구현 20/20) + Phase 2(통합+테스트 10/10) 완료 후, 3-adapter 패리티 + 시각화 + E2E.

## Tracks

```
Track A (Adapter Parity):  PO-1, PO-2              ← 병렬 가능
Track B (Visibility):      PO-3, PO-4              ← 병렬 가능
Track C (Quality):         PO-5                     ← Track A 이후
```

---

## Track A: 3-Adapter Parity

### PO-1: Codex Adapter Hook Wiring

- **Goal**: Codex 어댑터에 parliament 세션 트리거 추가
- **Size**: S (~40줄)
- **First touch files**:
  - `platform/adapters/codex/hooks/hooks.json` — AfterToolUse hook에 parliament 경로 확인
  - Codex의 PostToolUse 상당 hook에서 `bridge.runParliamentSession()` 분기 추가
- **Implementation**:
  - Claude Code index.mjs와 동일한 패턴: T3 + `config.parliament.enabled` → runParliamentSession()
  - Codex는 file-watch 기반이므로 AfterToolUse에서 트리거
- **Done**: Codex에서 T3 변경 시 parliament 세션 실행 가능

### PO-2: Gemini Adapter Hook Wiring

- **Goal**: Gemini 어댑터에 parliament 세션 트리거 추가
- **Size**: S (~40줄)
- **First touch files**:
  - `platform/adapters/gemini/hooks/hooks.json` — AfterAgent hook에 parliament 경로 확인
  - Gemini의 해당 hook에서 `bridge.runParliamentSession()` 분기 추가
- **Implementation**:
  - Claude Code와 동일한 패턴
  - Gemini는 AfterAgent hook 사용
- **Done**: Gemini에서 T3 변경 시 parliament 세션 실행 가능

---

## Track B: Visibility

### PO-3: Projector Parliament Views

- **Goal**: projector.ts에 parliament 세션/개정/수렴 마크다운 생성 추가
- **Size**: S (~100줄)
- **First touch files**:
  - `bus/projector.ts` — parliament 뷰 함수 추가
- **Implementation**:
  - `projectSessionDigest()`: 최근 세션 요약 마크다운
  - `projectAmendmentLog()`: 개정안 목록 + 투표 현황
  - `projectConvergenceStatus()`: 안건별 수렴 상태 + Normal Form 진행도
- **Done**: 3가지 parliament 마크다운 뷰 생성 가능

### PO-4: TUI Dashboard Panel

- **Goal**: daemon TUI에 parliament 상태 패널 추가
- **Size**: M (~120줄)
- **First touch files**:
  - `daemon/components/` — ParliamentPanel 컴포넌트
  - `daemon/app.tsx` — 패널 등록
- **Implementation**:
  - 수렴 상태 (6개 안건별 converged/pending)
  - 최근 세션 verdict 요약
  - 대기 중 개정안 수
  - Normal Form 진행률 바
- **Done**: TUI에서 parliament 상태 실시간 확인 가능

---

## Track C: Quality

### PO-5: E2E Parliament Test

- **Goal**: hook→bridge→session→verdict 전체 파이프라인 E2E 테스트
- **Prerequisite**: PO-1 또는 PO-2
- **Size**: M (~150줄)
- **First touch files**:
  - `tests/parliament-e2e.test.mjs` — **신규**
- **Implementation**:
  - Mock auditor 3개 (advocate/devil/judge)로 full session 실행
  - 미팅 로그 축적 → 수렴 판정 → CPS 생성 검증
  - 개정안 발의 → 투표 → 의결 검증
  - Confluence 4-check 검증
  - Normal Form 리포트 검증
- **Done**: 전체 파이프라인 E2E 통과

---

## Summary

| Track | WB | 크기 | 병렬 |
|-------|-----|:----:|:----:|
| A Adapter Parity | PO-1, PO-2 | S | ✓ |
| B Visibility | PO-3, PO-4 | S~M | ✓ |
| C Quality | PO-5 | M | PO-1/2 이후 |

**총 5개 WB**
