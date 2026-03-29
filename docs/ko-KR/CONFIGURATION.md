# quorum 설정 레퍼런스

> 전체 설정 스키마, 훅, 의회 설정. 명령어 사용법은 [명령어 레퍼런스](COMMANDS.md) 참조.

---

## 설정 파일 위치

```
.claude/quorum/config.json
```

`quorum setup` 최초 실행 시 `examples/config.example.json`에서 자동 생성.

---

## 전체 스키마

```jsonc
{
  "consensus": {
    "trigger_tag": "[REVIEW_NEEDED]",      // 증거 제출 마커
    "agree_tag": "[APPROVED]",             // 감사 승인 마커
    "pending_tag": "[CHANGES_REQUESTED]",  // 거절 마커
    "roles": {                             // 합의 역할별 프로바이더
      "advocate": "claude",
      "devil": "claude",
      "judge": "claude"
    }
  },

  "hooks": {
    // 사용자 정의 훅 (이벤트 → 핸들러 배열)
    "audit.submit": [
      {
        "name": "freeze-guard",
        "handler": {
          "type": "command",               // "command" 또는 "http"
          "command": "node scripts/check.mjs"
        }
      }
    ]
  },

  "parliament": {
    "enabled": true,                       // 의회 프로토콜 활성화
    "convergenceThreshold": 2,             // 수렴 필요 라운드 수
    "eligibleVoters": 3,                   // 투표 인원
    "maxRounds": 10,                       // 최대 심의 라운드
    "maxAutoAmendments": 5,                // 최대 자동 개정안 수
    "roles": {                             // consensus.roles 재지정
      "advocate": "claude",
      "devil": "claude",
      "judge": "claude"
    }
  }
}
```

---

## 훅 설정

### 이벤트 타입

58개 버스 이벤트 타입에 훅 등록 가능:

| 이벤트 | 시점 |
|--------|------|
| `audit.submit` | 증거 제출 시 |
| `audit.verdict` | 감사 판정 수신 시 |
| `track.complete` | 트랙 실행 완료 시 |
| `quality.fail` | 품질 검증 실패 시 |

### 핸들러 타입

**Command 핸들러:**
```jsonc
{
  "type": "command",
  "command": "node scripts/my-hook.mjs",
  "timeout": 10000,        // ms, 선택
  "async": false            // true면 fire-and-forget
}
```

**HTTP 핸들러:**
```jsonc
{
  "type": "http",
  "url": "https://hooks.example.com/notify",
  "method": "POST",
  "headers": { "Authorization": "Bearer $HOOK_TOKEN" }
}
```

환경변수 보간: 명령/URL/헤더에서 `$VAR` 또는 `${VAR}` 사용.

### 실행 규칙

- **deny-first-break**: 어떤 핸들러든 `{ "decision": "block" }` 반환 시 체인 중단
- **async: true**: fire-and-forget, 블로킹 없음
- **matcher**: 이벤트 페이로드 대상 정규식 필터 (예: `"matcher": "*.ts"`)

---

## 프로바이더 설정

### 역할별 프로바이더 매핑

```jsonc
{
  "consensus": {
    "roles": {
      "advocate": "openai",     // 다른 모델이 장점 발견
      "devil": "claude",        // 다른 모델이 도전
      "judge": "codex"          // 다른 모델이 판정
    }
  }
}
```

우선순위: CLI 플래그 > `parliament.roles` > `consensus.roles` > 기본값.

---

## 템플릿

`.claude/quorum/templates/`에 커스텀 감사/회고 템플릿:

| 파일 | 용도 |
|------|------|
| `audit-prompt.md` | 커스텀 감사 프롬프트 |
| `fix-prompt.md` | 커스텀 수정 프롬프트 |
| `retro-prompt.md` | 커스텀 회고 프롬프트 |

참조 파일: `references/en/` 및 `references/ko/` (이중 언어).

---

## 디렉토리 구조

모든 소스 모듈은 `platform/` 아래에 있습니다. 루트 레벨 파사드 디렉토리는 제거되었습니다.

```
quorum/
  platform/              ← 전체 소스 코드
    cli/                   CLI 디스패처 + 전체 명령어
    bus/                   이벤트 버스, SQLite 스토어, 의회
    core/                 브릿지, 컨텍스트, 강제, MCP 도구
    orchestrate/          기획, 실행, 거버넌스, 상태
    providers/            합의, 트리거, AST, 라우팅
    adapters/             공유 어댑터 로직 + 어댑터별 I/O
    skills/               스킬 정의
  agents/knowledge/      ← 크로스 어댑터 공유 프로토콜
  languages/             ← 언어 사양 + 프래그먼트
  daemon/                ← TUI 대시보드
```

**경로 해석**: `resolvePluginPath()`는 `PROJECT_CONFIG_DIR`을 먼저 확인하고, 어댑터 환경변수 루트(`QUORUM_ADAPTER_ROOT`/`CLAUDE_PLUGIN_ROOT`/`GEMINI_EXTENSION_ROOT`) 순서로 검색합니다.

---

## 어댑터

| 어댑터 | 설정 소스 | 환경변수 폴백 |
|--------|----------|--------------|
| Claude Code | `QUORUM_ADAPTER_ROOT` | `CLAUDE_PLUGIN_ROOT` |
| Gemini CLI | `QUORUM_ADAPTER_ROOT` | `GEMINI_EXTENSION_ROOT` |
| Codex | `QUORUM_ADAPTER_ROOT` | — |
