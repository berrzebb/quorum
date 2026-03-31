# Spec - Claude Code Pattern Adoption Control Plane

## 1. Module Surface

이번 트랙은 `platform/providers`와 `platform/core/harness`, `platform/bus`, `daemon` 사이의 계약을 확장한다. 중심은 provider transport 자체보다, 유출된 Claude Code에서 검증된 host-runtime 패턴을 quorum control plane에 도입하는 것이다.

| 모듈 | 역할 |
|------|------|
| `platform/providers/session-runtime.ts` | provider-native interactive runtime 계약 |
| `platform/providers/session-ledger.ts` | provider session/thread tracking |
| `platform/core/tools/tool-capabilities.mjs` | canonical tool capability registry |
| `platform/orchestrate/execution/output-tail.ts` | long-session output cursor / delta reader |
| `platform/orchestrate/execution/wave-compact.ts` | compact summary + bounded restore |
| `platform/orchestrate/execution/context-fork.ts` | forked child context isolation |
| `platform/providers/codex/app-server/*` | Codex App Server client, mapper, runtime |
| `platform/providers/claude-sdk/*` | Claude SDK runtime, permissions, tool bridge |
| `platform/providers/auditors/*` | 기존 one-shot auditor path |
| `platform/core/harness/provider-session-record.ts` | quorum session ↔ provider session binding |
| `platform/bus/provider-approval-gate.ts` | provider-native approval을 quorum gate로 연결 |
| `daemon/state/store.ts` | provider session projection용 daemon state spine |
| `daemon/components/design-system/*` | provider-native session panel 공통 primitive |

## 2. Type Contracts

```ts
export type ProviderExecutionMode =
  | "cli_exec"
  | "app_server"
  | "agent_sdk";

export interface SessionRuntimeRequest {
  prompt: string;
  cwd: string;
  sessionId: string;
  contractId?: string;
  resumeFrom?: ProviderSessionRef;
  metadata?: Record<string, unknown>;
}

export interface ProviderSessionRef {
  provider: "codex" | "claude";
  executionMode: ProviderExecutionMode;
  providerSessionId: string;
  threadId?: string;
  turnId?: string;
}

export interface ProviderSessionRecord {
  quorumSessionId: string;
  contractId?: string;
  providerRef: ProviderSessionRef;
  startedAt: number;
  updatedAt: number;
  state: "running" | "waiting_approval" | "completed" | "failed" | "detached";
}

export interface ProviderApprovalRequest {
  providerRef: ProviderSessionRef;
  requestId: string;
  kind: "tool" | "command" | "diff" | "network";
  reason: string;
  scope?: string[];
}

export interface ProviderApprovalDecision {
  requestId: string;
  decision: "allow" | "deny";
  remember?: boolean;
}

export interface ProviderRuntimeEvent {
  providerRef: ProviderSessionRef;
  kind:
    | "thread_started"
    | "turn_started"
    | "item_started"
    | "item_delta"
    | "item_completed"
    | "approval_requested"
    | "turn_completed"
    | "session_completed"
    | "session_failed";
  payload: Record<string, unknown>;
  ts: number;
}

export interface SessionRuntime {
  readonly provider: "codex" | "claude";
  readonly mode: ProviderExecutionMode;
  start(request: SessionRuntimeRequest): Promise<ProviderSessionRef>;
  resume(ref: ProviderSessionRef, request?: Partial<SessionRuntimeRequest>): Promise<void>;
  send(ref: ProviderSessionRef, input: string): Promise<void>;
  stop(ref: ProviderSessionRef): Promise<void>;
  poll?(ref: ProviderSessionRef): Promise<ProviderRuntimeEvent[]>;
  status(ref: ProviderSessionRef): Promise<"running" | "completed" | "failed" | "detached">;
}

export interface ProviderToolBridge {
  provider: "codex" | "claude";
  buildToolConfig(input: {
    repoRoot: string;
    contractId?: string;
    allowedTools: string[];
  }): Promise<Record<string, unknown>>;
}

export interface ProviderRuntimeFactory {
  createCodexRuntime(mode: "cli_exec" | "app_server"): SessionRuntime;
  createClaudeRuntime(mode: "cli_exec" | "agent_sdk"): SessionRuntime;
}
```

## 3. Compatibility Contract

- 기존 `Auditor` 계약은 유지한다.
- `SessionRuntime`는 additive surface다.
- `createAuditor()` / `createConsensusAuditors()`는 초기 단계에서 계속 동작해야 한다.
- default mode는 초기 rollout 동안 `cli_exec`다.
- `app_server` / `agent_sdk`는 explicit feature flag 또는 config opt-in 뒤에만 활성화된다.

## 3.1 Control-Plane Contract Adopted from Leaked Claude Code

- tool policy는 provider별 하드코딩이 아니라 canonical capability registry에서 파생된다.
- provider/native session output은 full reread가 아니라 file + offset cursor 기반 delta read를 사용한다.
- 장시간 wave/session handoff는 compact summary + bounded restore를 사용한다.
- 병렬 child runtime은 부모 baseline context를 fork하되 mutation은 격리한다.
- daemon은 raw polling result를 직접 패널로 뿌리지 않고, store/selector를 통해 provider session projection을 소비한다.

이 다섯 계약은 App Server/Agent SDK 구현보다 선행하는 foundation이며, provider별 구현은 이 계약을 우회할 수 없다.

### 3.1.1 Implementation Status (Frozen after SDK-11)

| Contract | Module | Commit | Status |
|----------|--------|--------|--------|
| Tool Capability Registry | `platform/core/tools/tool-capabilities.mjs` | SDK-5 | ✅ 26 tools, 58 tests |
| Deferred Loading + Role Split | `tool-capabilities.mjs` `buildToolSurface()` + `mcp-server.mjs` filter | SDK-6 | ✅ 7 tests |
| Output File Cursor | `platform/orchestrate/execution/output-tail.ts` | SDK-7 | ✅ 12 tests |
| Compact Handoff + Circuit Breaker | `platform/orchestrate/execution/wave-compact.ts` | SDK-8 | ✅ 10 tests |
| Forked Child Context | `platform/orchestrate/execution/context-fork.ts` | SDK-8 | ✅ 8 tests |
| Daemon Store + Selectors | `daemon/state/store.ts` | SDK-9 | ✅ 15 tests |
| Design System Primitives | `daemon/components/design-system/` | SDK-10 | ✅ 12 tests |

**These modules are FROZEN for Phase 3.** Provider runtime wiring (SDK-12~15) consumes these contracts; it does not modify them.

## 4. Codex App Server Contract

- transport는 bidirectional JSON-RPC over stdio를 전제로 한다.
- core lifecycle 단위는 `thread`, `turn`, `item`이다.
- app server approval request는 quorum approval gate를 거쳐야 한다.
- app server event stream은 `ProviderRuntimeEvent`로 정규화된다.
- Codex fallback path는 `codex exec` one-shot audit다.

## 5. Claude Agent SDK Contract

- SDK runtime은 optional dependency로 로드한다.
- filesystem settings parity가 필요할 때는 `settingSources: ["project"]`를 사용한다.
- permission handling은 `permissionMode`와 `canUseTool`를 통한다.
- quorum tool exposure는 `createSdkMcpServer()` 또는 native `tool()` bridge를 사용한다.
- session resume/introspection은 SDK session APIs를 통해 읽는다.
- Claude fallback path는 `claude -p` one-shot audit다.

## 6. Harness Contract

- provider-native session은 `HandoffArtifact`와 분리되어 독자 의미를 갖지 않는다. 항상 quorum `sessionId`/`contractId`에 귀속된다.
- approval request는 provider runtime 내부에서 바로 allow되지 않는다.
- contract gate가 block이면 `canUseTool` 혹은 approval reply에서 `deny`를 강제한다.
- session resume는 `ProviderSessionRecord`와 `HandoffArtifact` 둘 다 만족해야 허용된다.

## 6.1 Tool Capability Contract

- tool metadata는 최소 다음 필드를 가진다:
  - `readOnly`
  - `destructive`
  - `concurrencySafe`
  - `allowedRoles`
  - `alwaysLoad`
  - `shouldDefer`
  - `searchHint`
  - `domain`
- `mcp-server`, `tool-bridge`, `permissions`, approval gate는 같은 capability source를 본다.
- provider-specific runtime은 tool policy를 재정의하지 못하고 capability registry의 consumer일 뿐이다.

## 6.2 Output Cursor Contract

- provider-native session output은 append-only file을 primary persistence로 사용한다.
- 소비자는 `OutputCursor`를 통해 delta-only read를 수행한다.
- truncation/rotation이 감지되면 cursor reset path를 타야 한다.
- daemon/orchestrator는 steady-state에서 전체 파일 reread를 하면 안 된다.

## 6.3 Compact and Fork Contract

- compact summary는 최소 `changedFiles`, `fitness`, `unresolvedFindings`, `topFiles`, `nextConstraints`를 포함한다.
- restore file 수는 bounded budget를 가진다.
- compact failure streak는 circuit breaker를 가진다.
- child runtime은 parent context baseline을 공유하되, child overlay mutation은 sibling에게 보이면 안 된다.

## 6.4 Daemon Session Projection Contract

- provider-native session state는 projector를 거쳐 daemon store에 publish된다.
- panel은 selector 기반 slice만 구독한다.
- design-system primitive는 provider session panel이 공유하는 UI surface를 정의하지만, shell focus/navigation authority는 바꾸지 않는다.

## 7. Granularity Rules

- `codex/app-server`와 `claude-sdk`는 protocol/runtime mapper와 CLI fallback을 한 파일에 섞지 않는다.
- `permissions`, `tool-bridge`, `session-ledger`, `event-mapper`는 별도 파일로 둔다.
- `SessionRuntime` 구현은 presentation, CLI command parsing, daemon UI 코드를 포함하지 않는다.

## 8. Migration Acceptance

- `cli_exec` fallback이 유지된다.
- `app_server`와 `agent_sdk` path가 각각 독립 테스트로 검증된다.
- approval/tool/session mapping이 bus/harness contract를 우회하지 않는다.

## 9. Runtime Assumptions

Each provider runtime operates under distinct assumptions about transport, dependencies, lifecycle, and hosting. These are the official constraints that implementation code MUST respect.

### 9.1 Codex App Server

| Aspect | Assumption |
|--------|-----------|
| **Transport** | Bidirectional JSON-RPC 2.0 over stdio. The client sends requests and receives both responses and server-initiated requests on the same pipe pair. |
| **Binary** | `codex` CLI must support `--app-server` (or equivalent) mode. The binary is resolved via `resolveProviderBinary()` in `platform/orchestrate/core/provider-binary.ts`. |
| **Lifecycle units** | `thread` → `turn` → `item` (nested, ordered). A thread contains one or more turns; a turn contains one or more items. Items emit deltas. |
| **Approval** | The server sends approval requests (`tool`, `command`, `diff`, `network`) as JSON-RPC server-initiated requests. The client MUST respond with `allow` or `deny`. Unanswered requests block the turn indefinitely. |
| **Session resume** | Thread IDs are stable. A detached session can be re-attached by passing the same `threadId` in `ProviderSessionRef`. The server is expected to replay unacknowledged events. |
| **Dependencies** | `codex` binary at a pinned version. No npm package required. Version compatibility is checked at startup via `codex --version` output parsing. |
| **Local mode** | Subprocess communication via stdin/stdout. No network sockets. The `jsonrpc-client.mjs` module handles the bidirectional protocol with a 10 MB buffer guard and request timeout. |
| **Production mode** | Pinned binary in a controlled environment. The binary path can be overridden via `config.json` (`codex.binary`) or `QUORUM_CODEX_BINARY` env var. |
| **Error model** | JSON-RPC error responses (code + message + data). Transport-level errors (process exit, broken pipe) are mapped to `session_failed` events. |
| **Concurrency** | One thread per subprocess. Multiple concurrent sessions require multiple subprocesses. The `ProcessMux` layer manages subprocess pooling. |

### 9.2 Claude Agent SDK

| Aspect | Assumption |
|--------|-----------|
| **Package** | `@anthropic-ai/claude-agent-sdk` as an **optional** dependency. Not listed in `dependencies` — loaded via dynamic `import()` with try/catch. |
| **Runtime** | In-process Node.js execution. The SDK runs inside the quorum process — NOT as a subprocess. This means shared memory, shared event loop, and no IPC overhead. |
| **Permission model** | `permissionMode` controls the tool approval policy at session creation. Values: `"default"` (prompt user), `"acceptEdits"` (auto-approve file writes), `"bypassPermissions"` (no prompts — for CI/automation). |
| **Tool bridge** | `canUseTool(toolName, toolInput)` callback invoked before every tool execution. Returns `boolean`. Quorum gates (contract enforcement, scope gates, claim checks) are wired into this callback. |
| **MCP exposure** | `createSdkMcpServer()` exposes quorum's deterministic MCP tools (code_map, blast_radius, rtm_parse, etc.) to the SDK agent as native tools. The SDK connects to this server via stdio MCP transport. |
| **Session API** | `listSessions()` and `getSessionMessages()` provide post-hoc introspection. Used by the daemon TUI and audit-loop to read agent output without file-based IPC. |
| **Settings** | `settingSources: ["project"]` when the agent needs to respect project-level `.claude/settings.json`. Omitted when running in isolated/sandboxed mode. |
| **Local hosting** | No sandbox. The SDK agent has full filesystem and network access, gated only by `canUseTool` and `permissionMode`. Suitable for developer workstations. |
| **Production hosting** | Sandboxed container (Docker/Firecracker). `permissionMode: "bypassPermissions"` combined with container-level isolation. Network restricted to API endpoints only. |
| **Graceful fallback** | If the SDK package is not installed (`import()` fails), all code paths fall back to `claude -p` CLI one-shot mode. A warning is emitted to stderr and logged as a bus event. No crash. No behavioral change from pre-SDK baseline. |
| **Version compatibility** | The SDK version is checked at load time. If the installed version is below the minimum required (`MIN_SDK_VERSION` constant), fallback to CLI mode with a version-mismatch warning. |

### 9.3 CLI Exec (Baseline)

These assumptions apply to the existing `cli_exec` mode and remain unchanged:

| Aspect | Assumption |
|--------|-----------|
| **Codex** | `codex exec --json -` one-shot stdin pipe. Output parsed by `NdjsonParser`. |
| **Claude** | `claude -p --model <model>` one-shot stdin pipe. Output parsed by `CliAdapter`. |
| **HTTP providers** | Direct HTTP for OpenAI, Ollama, vLLM. No subprocess. |
| **Session model** | Stateless. Each invocation is independent. No resume capability. |
| **Dependencies** | Provider binary on PATH or configured path. No npm packages for runtime. |

## 10. Feature Flag Policy

### 10.1 Configuration Schema

The `config.json` `providers` section gains a `runtime` field:

```ts
interface ProviderRuntimeConfig {
  codex: {
    mode: "cli_exec" | "app_server";
    binary?: string;     // path override for codex binary
    timeout?: number;     // per-session timeout in ms (default: 300000)
  };
  claude: {
    mode: "cli_exec" | "agent_sdk";
    binary?: string;     // path override for claude CLI (cli_exec mode only)
    timeout?: number;     // per-session timeout in ms (default: 300000)
  };
}
```

Example `config.json` snippet:

```json
{
  "providers": {
    "runtime": {
      "codex": { "mode": "app_server" },
      "claude": { "mode": "agent_sdk" }
    }
  }
}
```

### 10.2 Feature Flag Rules

1. **Default is `cli_exec`**. If the `runtime` section is absent, or a provider's `mode` field is missing, the system behaves identically to the pre-SDK-adoption baseline. Zero behavioral change without explicit opt-in.

2. **Explicit opt-in required**. `app_server` and `agent_sdk` modes activate ONLY when the corresponding `mode` value is set in `config.json`. Environment variable overrides are NOT supported for mode selection — this is a deliberate constraint to prevent accidental activation in CI.

3. **Flag check location**. The feature flag is read in `platform/providers/auditors/factory.ts` at `createConsensusAuditors()` time and in the `ProviderRuntimeFactory` implementation. The flag value is resolved once per session and cached — no mid-session mode switching.

4. **Graceful fallback on missing dependency**. If the opted-in mode's dependency is unavailable:
   - `app_server`: `codex` binary not found or doesn't support `--app-server` → fall back to `cli_exec`.
   - `agent_sdk`: `@anthropic-ai/claude-agent-sdk` not installed or below `MIN_SDK_VERSION` → fall back to `cli_exec`.
   - Fallback emits a `provider.runtime.fallback` bus event with `{ provider, requestedMode, actualMode, reason }`.
   - Fallback logs a warning to stderr: `[quorum] ${provider} mode "${requestedMode}" unavailable (${reason}), falling back to cli_exec`.

5. **Session-start event**. On every session start, the resolved runtime mode is logged as a `provider.runtime.resolved` bus event:
   ```ts
   {
     type: "provider.runtime.resolved",
     payload: {
       provider: "codex" | "claude",
       configuredMode: "cli_exec" | "app_server" | "agent_sdk",
       resolvedMode: "cli_exec" | "app_server" | "agent_sdk",
       fallback: boolean,
       fallbackReason?: string,
       version?: string
     }
   }
   ```

6. **No flag = no change**. This is the cardinal rule. A fresh install with no `runtime` configuration MUST produce identical behavior to the pre-SDK-adoption codebase. This is verified by the existing test suite running without any config changes.

### 10.3 Flag Validation

- Unknown mode values (e.g., `"mode": "grpc"`) are rejected at config load time with a clear error message.
- The `binary` field is validated only when the corresponding mode needs it (`cli_exec` always, `app_server` always, `agent_sdk` never).
- `timeout` defaults to 300000 ms (5 minutes). Values below 10000 ms or above 600000 ms emit a warning but are accepted.

## 11. Rollout Stages

The transition from CLI-only to SDK-native runtimes follows a 4-stage progression. Each stage has explicit entry criteria and rollback conditions.

### Stage 0 — Current State (pre-adoption)

- **Runtime**: `cli_exec` only for all providers.
- **Config**: No `runtime` section in `config.json`.
- **Feature flags**: None. The `ProviderRuntimeConfig` type does not exist yet.
- **Test coverage**: Existing test suite (1601 tests) validates `cli_exec` behavior.
- **This is the baseline**. All subsequent stages are measured against Stage 0 behavior.

### Stage 1 — Flags Added, Default `cli_exec`

- **Entry criteria**: SDK-1 through SDK-8 implementation complete. All new tests pass.
- **Runtime**: `cli_exec` remains the default. `app_server` and `agent_sdk` are available behind explicit `config.json` opt-in.
- **Config**: `providers.runtime` section recognized but optional.
- **Behavioral guarantee**: Without config changes, the system is byte-for-byte identical to Stage 0. The flag infrastructure is inert.
- **Validation**:
  - Existing test suite passes without config changes (Stage 0 parity).
  - New integration tests exercise `app_server` and `agent_sdk` paths independently.
  - Fallback tests verify graceful degradation when dependencies are missing.
- **Rollback**: Remove `providers.runtime` from `config.json`. Immediate return to Stage 0.

### Stage 2 — Default Switches to New Runtimes

- **Entry criteria**: Stage 1 stable for ≥2 dogfooding cycles. No regressions in audit quality or gate pass rates.
- **Runtime**: Default mode for `codex` becomes `app_server`. Default mode for `claude` becomes `agent_sdk`. Users can opt back to `cli_exec` via config.
- **Config**: Absence of `mode` field now defaults to the new runtime (not `cli_exec`).
- **Behavioral guarantee**: The new defaults must pass the full gate chain (21 gates) with equivalent or better results than `cli_exec`.
- **Validation**:
  - Dogfooding results compared against Stage 1 baseline.
  - Fitness score distribution must not regress (mean ± 1 stddev).
  - All 4 adapters (Claude Code, Gemini, Codex, OpenAI-Compatible) tested.
- **Rollback**: Set `"mode": "cli_exec"` in config. Immediate return to Stage 1 behavior.

### Stage 3 — `cli_exec` Deprecated

- **Entry criteria**: Stage 2 stable for ≥4 dogfooding cycles. `cli_exec` usage in production drops below 10%.
- **Runtime**: `cli_exec` remains functional but emits a deprecation warning on every use.
- **Config**: `"mode": "cli_exec"` accepted with a deprecation notice logged at session start.
- **Behavioral guarantee**: `cli_exec` still works. No removal. Deprecation is advisory only.
- **Validation**:
  - Deprecation warnings are visible and actionable.
  - No test removals — `cli_exec` tests remain in the suite.
- **Rollback**: Remove deprecation warnings. Return to Stage 2.

### Stage Summary

| Stage | Default Mode | New Runtimes | `cli_exec` Status |
|-------|-------------|-------------|-------------------|
| 0 | `cli_exec` | Not available | Active (only option) |
| 1 | `cli_exec` | Opt-in via config | Active (default) |
| 2 | `app_server` / `agent_sdk` | Default | Active (opt-in) |
| 3 | `app_server` / `agent_sdk` | Default | Deprecated (functional) |
