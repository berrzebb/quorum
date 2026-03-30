#!/usr/bin/env node
/**
 * Claude SDK Contract Tests — SDK-13
 *
 * Comprehensive end-to-end contract tests for the Claude SDK stack:
 * 1. Event mapper contract (full event sequence)
 * 2. Permission bridge contract (gate enforced + not enforced)
 * 3. Session runtime contract (SDK unavailable + mocked available)
 * 4. Tool bridge contract (availability + tool inventory)
 * 5. Session ledger + approval gate integration
 *
 * All tests work WITHOUT the actual @anthropic-ai/claude-agent-sdk installed.
 *
 * Run: node --test tests/claude-sdk-contract.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Import compiled modules ─────────────────────────────────────────────────

const { ClaudeSdkEventMapper } = await import(
  "../dist/platform/providers/claude-sdk/mapper.js"
);
const { createRuntimeEvent } = await import(
  "../dist/platform/providers/event-mapper.js"
);
const { ClaudeSdkRuntime } = await import(
  "../dist/platform/providers/claude-sdk/runtime.js"
);
const { ClaudeSdkToolBridge, isClaudeSdkAvailable } = await import(
  "../dist/platform/providers/claude-sdk/tool-bridge.js"
);
const { ClaudePermissionBridge } = await import(
  "../dist/platform/providers/claude-sdk/permissions.js"
);
const {
  ProviderApprovalGate,
  AllowAllPolicy,
  ScopeBasedPolicy,
  DenyNetworkPolicy,
} = await import("../dist/platform/bus/provider-approval-gate.js");
const { InMemorySessionLedger } = await import(
  "../dist/platform/providers/session-ledger.js"
);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal ProviderSessionRef */
function makeRef(id = "contract-session-1") {
  return {
    provider: "claude",
    executionMode: "agent_sdk",
    providerSessionId: id,
  };
}

/** Register a session in the ledger */
function registerSession(ledger, ref, opts = {}) {
  ledger.upsert({
    quorumSessionId: opts.quorumSessionId || "q-contract-1",
    contractId: opts.contractId,
    providerRef: ref,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    state: opts.state || "running",
  });
}

/**
 * Subclass that mocks SDK availability AND session methods,
 * allowing session lifecycle tests without the actual SDK.
 */
class TestableClaudeSdkRuntime extends ClaudeSdkRuntime {
  async isAvailable() {
    return true;
  }

  async resolveSdkMethods() {
    if (this.sdkMethods) return this.sdkMethods;
    this.sdkMethods = {
      createSession: async () => ({ id: `mock-${Date.now()}` }),
      sendMessage: async () => {},
      stopSession: async () => {},
    };
    this.sdkChecked = true;
    return this.sdkMethods;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. EVENT MAPPER CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

describe("Contract: Event Mapper — full SDK event sequence", () => {
  const mapper = new ClaudeSdkEventMapper();
  const ref = makeRef("event-mapper-session");

  // The canonical SDK event sequence
  const sdkEventSequence = [
    { type: "session_start", data: { model: "claude-opus-4" } },
    { type: "message_start", data: { messageId: "msg-001" } },
    { type: "tool_use_start", name: "code_map", id: "tu-001" },
    { type: "content_block_delta", delta: { text: "chunk-1" } },
    { type: "content_block_delta", delta: { text: "chunk-2" } },
    { type: "content_block_delta", delta: { text: "chunk-3" } },
    { type: "tool_use_complete", name: "code_map", id: "tu-001", result: "ok" },
    { type: "message_complete", data: { stopReason: "end_turn" } },
    { type: "session_complete", data: { totalTokens: 1234 } },
  ];

  const expectedKinds = [
    "thread_started",
    "turn_started",
    "item_started",
    "item_delta",
    "item_delta",
    "item_delta",
    "item_completed",
    "turn_completed",
    "session_completed",
  ];

  it("maps all 9 events in the canonical sequence", () => {
    const mapped = sdkEventSequence.map((raw) => mapper.normalize(raw, ref));
    for (let i = 0; i < mapped.length; i++) {
      assert.ok(mapped[i], `Event ${i} (${sdkEventSequence[i].type}) should not be null`);
    }
    assert.equal(mapped.length, 9);
  });

  it("produces correct kind for each event in sequence", () => {
    const mapped = sdkEventSequence.map((raw) => mapper.normalize(raw, ref));
    for (let i = 0; i < mapped.length; i++) {
      assert.equal(
        mapped[i].kind,
        expectedKinds[i],
        `Event ${i}: expected kind "${expectedKinds[i]}", got "${mapped[i].kind}"`
      );
    }
  });

  it("all mapped events have correct providerRef", () => {
    const mapped = sdkEventSequence.map((raw) => mapper.normalize(raw, ref));
    for (const event of mapped) {
      assert.deepEqual(event.providerRef, ref);
    }
  });

  it("all mapped events have numeric ts", () => {
    const before = Date.now();
    const mapped = sdkEventSequence.map((raw) => mapper.normalize(raw, ref));
    const after = Date.now();
    for (const event of mapped) {
      assert.equal(typeof event.ts, "number");
      assert.ok(event.ts >= before && event.ts <= after, `ts out of range`);
    }
  });

  it("session_error maps to session_failed", () => {
    const raw = { type: "session_error", error: "timeout" };
    const event = mapper.normalize(raw, ref);
    assert.ok(event);
    assert.equal(event.kind, "session_failed");
    assert.equal(event.payload.error, "timeout");
  });

  it("content_block_delta events preserve delta payload", () => {
    const raw = { type: "content_block_delta", delta: { text: "hello" }, index: 2 };
    const event = mapper.normalize(raw, ref);
    assert.ok(event);
    assert.equal(event.kind, "item_delta");
    assert.deepEqual(event.payload.delta, { text: "hello" });
    assert.equal(event.payload.index, 2);
  });

  it("tool_use_start and tool_use_complete include kind=tool_call in payload", () => {
    const startEvt = mapper.normalize(
      { type: "tool_use_start", name: "blast_radius" },
      ref
    );
    const completeEvt = mapper.normalize(
      { type: "tool_use_complete", name: "blast_radius" },
      ref
    );
    assert.equal(startEvt.payload.kind, "tool_call");
    assert.equal(startEvt.payload.name, "blast_radius");
    assert.equal(completeEvt.payload.kind, "tool_call");
    assert.equal(completeEvt.payload.name, "blast_radius");
  });

  it("unknown event types return null (no leaks)", () => {
    const unknown = [
      { type: "stream_ping" },
      { type: "heartbeat" },
      {},
      { data: "no-type" },
    ];
    for (const raw of unknown) {
      assert.equal(mapper.normalize(raw, ref), null);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PERMISSION BRIDGE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

describe("Contract: Permission Bridge — quorum gate enforced", () => {
  let ledger;
  let gate;
  let sessionRef;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
    sessionRef = makeRef("perm-gate-session");
    registerSession(ledger, sessionRef);
  });

  it("gate with no policies denies all tools (fail-closed)", () => {
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const tools = ["code_map", "blast_radius", "bash", "write_file", "unknown_tool"];
    for (const tool of tools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, false, `Expected ${tool} to be denied`);
      assert.equal(result.source, "quorum-gate");
    }
  });

  it("gate with AllowAllPolicy allows all tools", () => {
    gate.addPolicy(new AllowAllPolicy());
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const tools = ["code_map", "bash", "write_file", "dangerous_op"];
    for (const tool of tools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, true, `Expected ${tool} to be allowed`);
      assert.equal(result.source, "quorum-gate");
    }
  });

  it("gate with ScopeBasedPolicy allows matching, denies non-matching", () => {
    const contractLedger = {
      getSprintContract: () => ({ scope: ["code_map", "blast_radius"] }),
    };
    const gateWithContract = new ProviderApprovalGate(ledger, contractLedger);
    gateWithContract.addPolicy(new ScopeBasedPolicy());

    const ref = makeRef("perm-scope-session");
    registerSession(ledger, ref, { contractId: "c-scope" });

    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gateWithContract
    );

    // Matching tools
    assert.equal(bridge.checkToolPermission("code_map", ref).allowed, true);
    assert.equal(bridge.checkToolPermission("blast_radius", ref).allowed, true);

    // Non-matching tools fall through to fail-closed
    assert.equal(bridge.checkToolPermission("bash", ref).allowed, false);
    assert.equal(bridge.checkToolPermission("write_file", ref).allowed, false);
  });

  it("buildCanUseTool returns a callable function", () => {
    gate.addPolicy(new AllowAllPolicy());
    const bridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const canUseTool = bridge.buildCanUseTool(sessionRef);
    assert.equal(typeof canUseTool, "function");
    assert.equal(canUseTool.length, 2); // (toolName, input)
  });

  it("canUseTool() returns boolean matching gate decision", () => {
    // No policies → deny
    const bridgeDeny = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const denyFn = bridgeDeny.buildCanUseTool(sessionRef);
    assert.equal(denyFn("code_map", {}), false);

    // With AllowAll → allow
    gate.addPolicy(new AllowAllPolicy());
    const bridgeAllow = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );
    const allowFn = bridgeAllow.buildCanUseTool(sessionRef);
    assert.equal(allowFn("code_map", {}), true);
    assert.equal(allowFn("bash", {}), true);
  });

  it("KEY INVARIANT: bypassPermissions SDK mode does NOT bypass quorum gate", () => {
    const config = { mode: "bypassPermissions", enforceQuorumGate: true };
    // No policies → fail-closed even in bypass mode
    const bridge = new ClaudePermissionBridge(config, gate);
    const result = bridge.checkToolPermission("dangerous_tool", sessionRef);
    assert.equal(result.allowed, false);
    assert.equal(result.source, "quorum-gate");
  });
});

describe("Contract: Permission Bridge — quorum gate NOT enforced", () => {
  let ledger;
  let gate;
  let sessionRef;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
    sessionRef = makeRef("perm-nogate-session");
    registerSession(ledger, sessionRef);
  });

  it("bypassPermissions mode allows all tools", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "bypassPermissions", enforceQuorumGate: false },
      gate
    );
    const tools = ["code_map", "bash", "write_file", "dangerous_op"];
    for (const tool of tools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, true, `Expected ${tool} allowed`);
      assert.equal(result.source, "sdk-mode");
      assert.ok(result.reason.includes("bypassPermissions"));
    }
  });

  it("plan mode allows read-only tools", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "plan", enforceQuorumGate: false },
      gate
    );
    const readOnly = [
      "code_map",
      "blast_radius",
      "dependency_graph",
      "audit_scan",
      "coverage_map",
      "doc_coverage",
    ];
    for (const tool of readOnly) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, true, `Expected ${tool} allowed in plan mode`);
      assert.equal(result.source, "sdk-mode");
      assert.ok(result.reason.includes("read-only"));
    }
  });

  it("plan mode denies write tools", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "plan", enforceQuorumGate: false },
      gate
    );
    const writeTools = ["write_file", "bash", "edit_file"];
    for (const tool of writeTools) {
      const result = bridge.checkToolPermission(tool, sessionRef);
      assert.equal(result.allowed, false, `Expected ${tool} denied in plan mode`);
      assert.equal(result.source, "sdk-mode");
      assert.ok(result.reason.includes("write tool blocked"));
    }
  });

  it("default mode denies all (requires approval)", () => {
    const bridge = new ClaudePermissionBridge(
      { mode: "default", enforceQuorumGate: false },
      gate
    );
    const result = bridge.checkToolPermission("any_tool", sessionRef);
    assert.equal(result.allowed, false);
    assert.equal(result.source, "sdk-mode");
    assert.ok(result.reason.includes("requires approval"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SESSION RUNTIME CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

describe("Contract: Session Runtime — SDK not available", () => {
  let runtime;

  beforeEach(() => {
    runtime = new ClaudeSdkRuntime();
  });

  it("isAvailable() returns false", async () => {
    const available = await runtime.isAvailable();
    assert.equal(available, false);
  });

  it("start() throws with descriptive error", async () => {
    await assert.rejects(
      () =>
        runtime.start({
          prompt: "hello",
          cwd: "/tmp",
          sessionId: "contract-1",
        }),
      { message: /Claude Agent SDK is not available/ }
    );
  });
});

describe("Contract: Session Runtime — mocked available (TestableClaudeSdkRuntime)", () => {
  let runtime;

  beforeEach(() => {
    runtime = new TestableClaudeSdkRuntime();
  });

  it("full lifecycle: start -> send -> poll -> stop", async () => {
    // Start
    const ref = await runtime.start({
      prompt: "implement feature X",
      cwd: "/tmp/project",
      sessionId: "lifecycle-1",
    });
    assert.equal(ref.provider, "claude");
    assert.equal(ref.executionMode, "agent_sdk");
    assert.ok(ref.providerSessionId.startsWith("claude-sdk-lifecycle-1-"));

    // Status after start
    assert.equal(await runtime.status(ref), "running");

    // Send
    await runtime.send(ref, "continue implementing");

    // Push mock events
    const evt1 = {
      providerRef: ref,
      kind: "turn_started",
      payload: { turnIndex: 0 },
      ts: Date.now(),
    };
    const evt2 = {
      providerRef: ref,
      kind: "item_started",
      payload: { kind: "tool_call", name: "code_map" },
      ts: Date.now(),
    };
    const evt3 = {
      providerRef: ref,
      kind: "item_completed",
      payload: { kind: "tool_call", name: "code_map" },
      ts: Date.now(),
    };
    runtime.pushEvent(ref.providerSessionId, evt1);
    runtime.pushEvent(ref.providerSessionId, evt2);
    runtime.pushEvent(ref.providerSessionId, evt3);

    // Poll retrieves events
    const events = await runtime.poll(ref);
    assert.equal(events.length, 3);
    assert.equal(events[0].kind, "turn_started");
    assert.equal(events[1].kind, "item_started");
    assert.equal(events[2].kind, "item_completed");

    // Poll again drains
    const events2 = await runtime.poll(ref);
    assert.deepStrictEqual(events2, []);

    // Stop
    await runtime.stop(ref);
    assert.equal(await runtime.status(ref), "detached");
  });

  it("pushEvent() adds events to poll queue", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "push-evt-1",
    });

    runtime.pushEvent(ref.providerSessionId, {
      providerRef: ref,
      kind: "thread_started",
      payload: {},
      ts: Date.now(),
    });
    runtime.pushEvent(ref.providerSessionId, {
      providerRef: ref,
      kind: "session_completed",
      payload: {},
      ts: Date.now(),
    });

    const events = await runtime.poll(ref);
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "thread_started");
    assert.equal(events[1].kind, "session_completed");
  });

  it("complete() changes status to completed", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "complete-1",
    });
    assert.equal(await runtime.status(ref), "running");

    runtime.complete(ref.providerSessionId);
    assert.equal(await runtime.status(ref), "completed");
  });

  it("fail() changes status to failed", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "fail-1",
    });
    assert.equal(await runtime.status(ref), "running");

    runtime.fail(ref.providerSessionId);
    assert.equal(await runtime.status(ref), "failed");
  });

  it("resume() on completed session throws", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "resume-completed-1",
    });
    runtime.complete(ref.providerSessionId);

    await assert.rejects(() => runtime.resume(ref), {
      message: /Cannot resume completed session/,
    });
  });

  it("resume() on failed session throws", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "resume-failed-1",
    });
    runtime.fail(ref.providerSessionId);

    await assert.rejects(() => runtime.resume(ref), {
      message: /Cannot resume failed session/,
    });
  });

  it("resume() on detached session re-activates it", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "resume-detached-1",
    });
    await runtime.stop(ref);
    assert.equal(await runtime.status(ref), "detached");

    await runtime.resume(ref);
    assert.equal(await runtime.status(ref), "running");
  });

  it("send() on stopped session throws", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "send-stopped-1",
    });
    await runtime.stop(ref);

    await assert.rejects(() => runtime.send(ref, "hello"), {
      message: /Cannot send to detached session/,
    });
  });

  it("multiple sessions are isolated", async () => {
    const ref1 = await runtime.start({
      prompt: "session A",
      cwd: "/tmp",
      sessionId: "iso-a",
    });
    const ref2 = await runtime.start({
      prompt: "session B",
      cwd: "/tmp",
      sessionId: "iso-b",
    });

    // Push to session A only
    runtime.pushEvent(ref1.providerSessionId, {
      providerRef: ref1,
      kind: "item_delta",
      payload: { text: "for-A" },
      ts: Date.now(),
    });

    // Session B should have no events
    const eventsB = await runtime.poll(ref2);
    assert.deepStrictEqual(eventsB, []);

    // Session A should have 1
    const eventsA = await runtime.poll(ref1);
    assert.equal(eventsA.length, 1);
    assert.equal(eventsA[0].payload.text, "for-A");

    // Complete A, B should still be running
    runtime.complete(ref1.providerSessionId);
    assert.equal(await runtime.status(ref1), "completed");
    assert.equal(await runtime.status(ref2), "running");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. TOOL BRIDGE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

describe("Contract: Tool Bridge", () => {
  it("SDK not available: buildToolConfig returns fallback", async () => {
    const bridge = new ClaudeSdkToolBridge({
      allowedTools: ["code_map"],
      useMcpServer: false,
      repoRoot: "/tmp/repo",
    });
    const config = await bridge.buildToolConfig({
      repoRoot: "/tmp/repo",
      allowedTools: ["code_map"],
    });
    assert.equal(config.available, false);
    assert.equal(config.fallback, "cli_exec");
    assert.equal(typeof config.reason, "string");
    assert.ok(String(config.reason).length > 0);
  });

  it("getAvailableTools() returns exactly 20 tools", () => {
    const tools = ClaudeSdkToolBridge.getAvailableTools();
    assert.equal(tools.length, 20);
  });

  it("all tool names are valid strings", () => {
    const tools = ClaudeSdkToolBridge.getAvailableTools();
    for (const tool of tools) {
      assert.equal(typeof tool, "string");
      assert.ok(tool.length > 0, `Tool name must be non-empty`);
      assert.ok(
        /^[a-z][a-z0-9_]*$/.test(tool),
        `Tool name "${tool}" must be lowercase snake_case`
      );
    }
  });

  it("tool list contains no duplicates", () => {
    const tools = ClaudeSdkToolBridge.getAvailableTools();
    const unique = new Set(tools);
    assert.equal(unique.size, tools.length, "Duplicate tool names detected");
  });

  it("each call returns a new array (no shared mutation)", () => {
    const a = ClaudeSdkToolBridge.getAvailableTools();
    const b = ClaudeSdkToolBridge.getAvailableTools();
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. SESSION LEDGER + APPROVAL GATE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

describe("Contract: Session Ledger + Approval Gate integration", () => {
  let ledger;
  let gate;

  beforeEach(() => {
    ledger = new InMemorySessionLedger();
    gate = new ProviderApprovalGate(ledger);
  });

  it("full approval lifecycle: record -> evaluate -> resolve -> verify", () => {
    const ref = makeRef("approval-lifecycle-1");
    registerSession(ledger, ref, { quorumSessionId: "q-approval-1" });

    gate.addPolicy(new AllowAllPolicy());

    const request = {
      providerRef: ref,
      requestId: "req-001",
      kind: "tool",
      reason: "code_map",
      scope: ["code_map"],
    };

    // Process goes through record -> evaluate -> resolve -> state update
    const decision = gate.process(request);

    // Decision
    assert.equal(decision.requestId, "req-001");
    assert.equal(decision.decision, "allow");

    // Approval is recorded and resolved in ledger
    const pending = ledger.pendingApprovals(ref.providerSessionId);
    assert.equal(pending.length, 0, "Resolved approvals should not be pending");

    // Session state should be restored to running
    const session = ledger.findByQuorumSession("q-approval-1");
    assert.equal(session.state, "running");
  });

  it("denied approval sets session state to failed", () => {
    const ref = makeRef("approval-deny-1");
    registerSession(ledger, ref, { quorumSessionId: "q-deny-1" });

    // No policies → fail-closed → deny
    const request = {
      providerRef: ref,
      requestId: "req-deny-001",
      kind: "tool",
      reason: "dangerous_tool",
    };

    const decision = gate.process(request);
    assert.equal(decision.decision, "deny");

    // Session state should be failed
    const session = ledger.findByQuorumSession("q-deny-1");
    assert.equal(session.state, "failed");
  });

  it("session state transitions: running -> waiting_approval -> running (on allow)", () => {
    const ref = makeRef("state-transition-1");
    registerSession(ledger, ref, { quorumSessionId: "q-transition-1" });

    gate.addPolicy(new AllowAllPolicy());

    // Before: running
    assert.equal(
      ledger.findByQuorumSession("q-transition-1").state,
      "running"
    );

    // Process triggers: running -> waiting_approval -> running
    gate.process({
      providerRef: ref,
      requestId: "req-trans-001",
      kind: "tool",
      reason: "code_map",
    });

    // After: running (restored)
    assert.equal(
      ledger.findByQuorumSession("q-transition-1").state,
      "running"
    );
  });

  it("session state transitions: running -> waiting_approval -> failed (on deny)", () => {
    const ref = makeRef("state-fail-1");
    registerSession(ledger, ref, { quorumSessionId: "q-fail-1" });

    // No policies → deny
    gate.process({
      providerRef: ref,
      requestId: "req-fail-001",
      kind: "tool",
      reason: "blocked_tool",
    });

    assert.equal(
      ledger.findByQuorumSession("q-fail-1").state,
      "failed"
    );
  });

  it("multiple approvals for same session are tracked independently", () => {
    const ref = makeRef("multi-approval-1");
    registerSession(ledger, ref, { quorumSessionId: "q-multi-1" });

    gate.addPolicy(new AllowAllPolicy());

    gate.process({
      providerRef: ref,
      requestId: "req-multi-001",
      kind: "tool",
      reason: "code_map",
    });
    gate.process({
      providerRef: ref,
      requestId: "req-multi-002",
      kind: "tool",
      reason: "blast_radius",
    });

    // Both resolved, none pending
    const pending = ledger.pendingApprovals(ref.providerSessionId);
    assert.equal(pending.length, 0);
  });

  it("ledger findByProviderSession looks up across all sessions", () => {
    const ref1 = makeRef("lookup-1");
    const ref2 = makeRef("lookup-2");
    registerSession(ledger, ref1, { quorumSessionId: "q-lookup-1" });
    registerSession(ledger, ref2, { quorumSessionId: "q-lookup-2" });

    const found = ledger.findByProviderSession("lookup-2");
    assert.ok(found);
    assert.equal(found.quorumSessionId, "q-lookup-2");
    assert.equal(found.providerRef.providerSessionId, "lookup-2");
  });

  it("ledger findByContract returns all sessions for a contract", () => {
    const ref1 = makeRef("contract-a-1");
    const ref2 = makeRef("contract-a-2");
    const ref3 = makeRef("contract-b-1");
    registerSession(ledger, ref1, {
      quorumSessionId: "q-ca-1",
      contractId: "sprint-42",
    });
    registerSession(ledger, ref2, {
      quorumSessionId: "q-ca-2",
      contractId: "sprint-42",
    });
    registerSession(ledger, ref3, {
      quorumSessionId: "q-cb-1",
      contractId: "sprint-43",
    });

    const sprint42 = ledger.findByContract("sprint-42");
    assert.equal(sprint42.length, 2);
    const sprint43 = ledger.findByContract("sprint-43");
    assert.equal(sprint43.length, 1);
    const sprint99 = ledger.findByContract("sprint-99");
    assert.equal(sprint99.length, 0);
  });

  it("ledger updateState changes session state", () => {
    const ref = makeRef("update-state-1");
    registerSession(ledger, ref, { quorumSessionId: "q-update-1" });

    assert.equal(ledger.findByQuorumSession("q-update-1").state, "running");

    ledger.updateState("q-update-1", "completed");
    assert.equal(ledger.findByQuorumSession("q-update-1").state, "completed");

    ledger.updateState("q-update-1", "detached");
    assert.equal(ledger.findByQuorumSession("q-update-1").state, "detached");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. END-TO-END: RUNTIME + MAPPER + PERMISSIONS + GATE
// ═══════════════════════════════════════════════════════════════════════════

describe("Contract: E2E — Runtime + Mapper + Permissions + Gate", () => {
  it("simulated SDK session with event mapping and permission checks", async () => {
    // Set up all components
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    const runtime = new TestableClaudeSdkRuntime();
    const mapper = new ClaudeSdkEventMapper();
    const permBridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );

    // 1. Start session
    const ref = await runtime.start({
      prompt: "implement feature",
      cwd: "/tmp/project",
      sessionId: "e2e-1",
    });
    registerSession(ledger, ref, { quorumSessionId: "q-e2e-1" });

    // 2. Check tool permission before use
    const canUseTool = permBridge.buildCanUseTool(ref);
    assert.equal(canUseTool("code_map", {}), true);

    // 3. Simulate SDK events via mapper
    const rawEvents = [
      { type: "session_start" },
      { type: "message_start", data: { model: "opus" } },
      { type: "tool_use_start", name: "code_map" },
      { type: "tool_use_complete", name: "code_map", result: "ok" },
      { type: "message_complete" },
    ];
    const mapped = rawEvents
      .map((raw) => mapper.normalize(raw, ref))
      .filter(Boolean);

    // 4. Push mapped events into runtime
    for (const event of mapped) {
      runtime.pushEvent(ref.providerSessionId, event);
    }

    // 5. Poll and verify
    const polled = await runtime.poll(ref);
    assert.equal(polled.length, 5);
    assert.equal(polled[0].kind, "thread_started");
    assert.equal(polled[4].kind, "turn_completed");

    // 6. All polled events have correct ref
    for (const evt of polled) {
      assert.deepEqual(evt.providerRef, ref);
    }

    // 7. Complete session
    runtime.complete(ref.providerSessionId);
    assert.equal(await runtime.status(ref), "completed");

    // 8. Cannot resume completed session
    await assert.rejects(() => runtime.resume(ref), {
      message: /Cannot resume completed session/,
    });
  });

  it("denied tool blocks in permission-aware flow", async () => {
    const ledger = new InMemorySessionLedger();
    const gate = new ProviderApprovalGate(ledger);
    // No policies → fail-closed

    const runtime = new TestableClaudeSdkRuntime();
    const permBridge = new ClaudePermissionBridge(
      ClaudePermissionBridge.defaultConfig(),
      gate
    );

    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "e2e-deny-1",
    });
    registerSession(ledger, ref, { quorumSessionId: "q-e2e-deny-1" });

    // Permission check should deny
    const canUseTool = permBridge.buildCanUseTool(ref);
    assert.equal(canUseTool("bash", {}), false);
    assert.equal(canUseTool("code_map", {}), false);

    // Full process call should deny and set state to failed
    const decision = gate.process({
      providerRef: ref,
      requestId: "req-e2e-deny-001",
      kind: "tool",
      reason: "bash",
    });
    assert.equal(decision.decision, "deny");
    assert.equal(
      ledger.findByQuorumSession("q-e2e-deny-1").state,
      "failed"
    );
  });
});
