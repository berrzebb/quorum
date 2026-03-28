/**
 * Contract tests for the Codex App Server stack.
 *
 * Verifies end-to-end contracts across:
 *   1. Protocol constants (CODEX_NOTIFICATIONS, CODEX_METHODS, JSON-RPC shapes)
 *   2. Client → Mapper → Runtime pipeline (mock notification sequence)
 *   3. Approval bridge (ProviderApprovalGate + InMemorySessionLedger)
 *   4. Fallback coexistence (app_server vs cli_exec)
 *   5. Session lifecycle (start → poll → notifications → stop/disconnect)
 *
 * Uses the TestableCodexAppServerRuntime pattern from codex-appserver-runtime.test.mjs.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Dynamic imports of compiled modules ─────────────
const { CodexAppServerRuntime } = await import(
  "../dist/platform/providers/codex/app-server/runtime.js"
);
const { CodexAppServerMapper } = await import(
  "../dist/platform/providers/codex/app-server/mapper.js"
);
const { CODEX_NOTIFICATIONS, CODEX_METHODS } = await import(
  "../dist/platform/providers/codex/app-server/protocol.js"
);
const { createRuntimeEvent } = await import(
  "../dist/platform/providers/event-mapper.js"
);
const { ProviderApprovalGate, AllowAllPolicy, DenyNetworkPolicy, ScopeBasedPolicy } = await import(
  "../dist/platform/bus/provider-approval-gate.js"
);
const { InMemorySessionLedger } = await import(
  "../dist/platform/providers/session-ledger.js"
);

// ─── FakeClient (reused from codex-appserver-runtime.test.mjs) ───
class FakeClient {
  connected = false;
  _threads = new Map();
  _nextThread = 1;
  _listeners = new Map();

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
  }

  emit(event, data) {
    for (const fn of this._listeners.get(event) ?? []) {
      fn(data);
    }
  }

  async connect() {
    this.connected = true;
    return { serverName: "fake-codex", serverVersion: "0.0.0", capabilities: {} };
  }

  async createThread(params) {
    const threadId = `thread-${this._nextThread++}`;
    this._threads.set(threadId, { params, status: "running" });
    return { threadId };
  }

  async sendInput(params) {
    const t = this._threads.get(params.threadId);
    if (!t) throw new Error(`Unknown thread: ${params.threadId}`);
  }

  async stopThread(params) {
    const t = this._threads.get(params.threadId);
    if (t) t.status = "stopped";
  }

  async disconnect() {
    this.connected = false;
  }
}

/**
 * Testable runtime: replaces the real client with FakeClient.
 */
class TestableCodexAppServerRuntime extends CodexAppServerRuntime {
  constructor() {
    super("codex", ["--app-server"], 30000);
    const fake = new FakeClient();
    this.client = fake;
    fake.on("notification", (notification) => {
      this.handleNotification(notification);
    });
  }

  get fakeClient() {
    return this.client;
  }

  simulateNotification(method, params = {}) {
    this.fakeClient.emit("notification", {
      jsonrpc: "2.0",
      method,
      params,
    });
  }
}

// ═══════════════════════════════════════════════════════
// 1. Protocol contract
// ═══════════════════════════════════════════════════════

describe("Protocol contract", () => {
  describe("CODEX_NOTIFICATIONS", () => {
    it("all values are strings", () => {
      for (const [key, value] of Object.entries(CODEX_NOTIFICATIONS)) {
        assert.equal(typeof value, "string", `${key} should be a string`);
      }
    });

    it("all values start with a valid prefix", () => {
      const validPrefixes = ["thread/", "turn/", "item/", "approval/", "session/"];
      for (const [key, value] of Object.entries(CODEX_NOTIFICATIONS)) {
        const hasValidPrefix = validPrefixes.some((p) => value.startsWith(p));
        assert.ok(hasValidPrefix, `${key} = "${value}" should start with one of: ${validPrefixes.join(", ")}`);
      }
    });

    it("contains all 9 expected notification types", () => {
      const expected = [
        "THREAD_STARTED",
        "TURN_STARTED",
        "ITEM_STARTED",
        "ITEM_DELTA",
        "ITEM_COMPLETED",
        "TURN_COMPLETED",
        "APPROVAL_REQUESTED",
        "SESSION_COMPLETED",
        "SESSION_FAILED",
      ];
      for (const name of expected) {
        assert.ok(
          name in CODEX_NOTIFICATIONS,
          `Missing notification: ${name}`
        );
      }
    });

    it("has no duplicate values", () => {
      const values = Object.values(CODEX_NOTIFICATIONS);
      const unique = new Set(values);
      assert.equal(values.length, unique.size, "Notification values should be unique");
    });
  });

  describe("CODEX_METHODS", () => {
    it("all values are strings", () => {
      for (const [key, value] of Object.entries(CODEX_METHODS)) {
        assert.equal(typeof value, "string", `${key} should be a string`);
      }
    });

    it("contains expected client→server methods", () => {
      const expected = [
        "INITIALIZE",
        "CREATE_THREAD",
        "SEND_INPUT",
        "APPROVAL_RESPONSE",
        "STOP_THREAD",
        "THREAD_STATUS",
      ];
      for (const name of expected) {
        assert.ok(name in CODEX_METHODS, `Missing method: ${name}`);
      }
    });
  });

  describe("JSON-RPC shape", () => {
    it("JsonRpcRequest shape: jsonrpc, id, method, optional params", () => {
      const request = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientName: "test" },
      };
      assert.equal(request.jsonrpc, "2.0");
      assert.equal(typeof request.id, "number");
      assert.equal(typeof request.method, "string");
      assert.equal(typeof request.params, "object");
    });

    it("JsonRpcRequest accepts string id", () => {
      const request = {
        jsonrpc: "2.0",
        id: "req-abc",
        method: "thread/create",
      };
      assert.equal(typeof request.id, "string");
      assert.equal(request.params, undefined);
    });

    it("JsonRpcNotification shape: jsonrpc, method, optional params (no id)", () => {
      const notification = {
        jsonrpc: "2.0",
        method: "thread/started",
        params: { threadId: "t-1" },
      };
      assert.equal(notification.jsonrpc, "2.0");
      assert.equal(typeof notification.method, "string");
      assert.equal(notification.id, undefined);
    });
  });
});

// ═══════════════════════════════════════════════════════
// 2. Client → Mapper → Runtime contract
// ═══════════════════════════════════════════════════════

describe("Client → Mapper → Runtime contract", () => {
  it("full notification sequence produces correctly mapped events", async () => {
    const rt = new TestableCodexAppServerRuntime();

    const ref = await rt.start({
      prompt: "fix the bug",
      cwd: "/tmp/project",
      sessionId: "contract-seq-1",
    });

    const tid = ref.threadId;

    // Simulate a full notification sequence (9 notifications)
    rt.simulateNotification(CODEX_NOTIFICATIONS.THREAD_STARTED, {
      threadId: tid,
      createdAt: 1000,
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.TURN_STARTED, {
      threadId: tid,
      turnId: "turn-1",
      role: "assistant",
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_STARTED, {
      threadId: tid,
      turnId: "turn-1",
      itemId: "item-1",
      kind: "message",
    });
    // 3 deltas
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: tid,
      turnId: "turn-1",
      itemId: "item-1",
      delta: "Hello",
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: tid,
      turnId: "turn-1",
      itemId: "item-1",
      delta: " world",
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: tid,
      turnId: "turn-1",
      itemId: "item-1",
      delta: "!",
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_COMPLETED, {
      threadId: tid,
      turnId: "turn-1",
      itemId: "item-1",
      kind: "message",
      status: "completed",
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.TURN_COMPLETED, {
      threadId: tid,
      turnId: "turn-1",
      itemCount: 1,
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_COMPLETED, {
      threadId: tid,
      summary: "Bug fixed",
    });

    const events = await rt.poll(ref);

    // Verify we got all 9 events
    assert.equal(events.length, 9, "Should have 9 events");

    // Verify kinds in order
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
    assert.deepEqual(
      events.map((e) => e.kind),
      expectedKinds
    );

    // Verify all events have correct providerRef
    for (const ev of events) {
      assert.equal(ev.providerRef.provider, "codex");
      assert.equal(ev.providerRef.providerSessionId, ref.providerSessionId);
      assert.ok(ev.ts > 0, "ts should be positive");
    }

    // Verify item_delta payloads are preserved
    const deltas = events.filter((e) => e.kind === "item_delta");
    assert.equal(deltas.length, 3);
    assert.equal(deltas[0].payload.delta, "Hello");
    assert.equal(deltas[1].payload.delta, " world");
    assert.equal(deltas[2].payload.delta, "!");

    // Verify session status changed to completed
    assert.equal(await rt.status(ref), "completed");
  });

  it("mapper returns null for unknown method", () => {
    const mapper = new CodexAppServerMapper();
    const ref = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "test",
    };
    const result = mapper.normalize({ method: "unknown/method", params: {} }, ref);
    assert.equal(result, null);
  });

  it("mapper returns null when method is missing", () => {
    const mapper = new CodexAppServerMapper();
    const ref = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "test",
    };
    const result = mapper.normalize({ params: {} }, ref);
    assert.equal(result, null);
  });

  it("mapper preserves all payload fields", () => {
    const mapper = new CodexAppServerMapper();
    const ref = {
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "test-preserve",
    };
    const result = mapper.normalize(
      {
        method: CODEX_NOTIFICATIONS.ITEM_DELTA,
        params: {
          threadId: "t-1",
          turnId: "turn-1",
          itemId: "item-1",
          delta: "chunk data",
          extra: "custom-field",
        },
      },
      ref
    );
    assert.ok(result);
    assert.equal(result.kind, "item_delta");
    assert.equal(result.payload.delta, "chunk data");
    assert.equal(result.payload.extra, "custom-field");
    assert.equal(result.payload.threadId, "t-1");
  });
});

// ═══════════════════════════════════════════════════════
// 3. Approval bridge contract
// ═══════════════════════════════════════════════════════

describe("Approval bridge contract", () => {
  let rt;
  let ledger;

  beforeEach(() => {
    rt = new TestableCodexAppServerRuntime();
    ledger = new InMemorySessionLedger();
  });

  it("approval_requested notification appears in poll() with correct kind", async () => {
    const ref = await rt.start({
      prompt: "run tests",
      cwd: "/tmp",
      sessionId: "approval-1",
    });

    rt.simulateNotification(CODEX_NOTIFICATIONS.APPROVAL_REQUESTED, {
      threadId: ref.threadId,
      requestId: "req-42",
      kind: "tool",
      reason: "exec npm test",
    });

    const events = await rt.poll(ref);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "approval_requested");
    assert.equal(events[0].payload.requestId, "req-42");
    assert.equal(events[0].payload.kind, "tool");
    assert.equal(events[0].payload.reason, "exec npm test");
  });

  it("ProviderApprovalGate with AllowAllPolicy processes approval", async () => {
    const ref = await rt.start({
      prompt: "run tests",
      cwd: "/tmp",
      sessionId: "approval-2",
    });

    // Register session in ledger
    ledger.upsert({
      quorumSessionId: "qs-1",
      providerRef: ref,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });

    // Create gate with allow-all policy
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    // Simulate approval request
    rt.simulateNotification(CODEX_NOTIFICATIONS.APPROVAL_REQUESTED, {
      threadId: ref.threadId,
      requestId: "req-100",
      kind: "tool",
      reason: "exec npm test",
    });

    const events = await rt.poll(ref);
    const approvalEvent = events.find((e) => e.kind === "approval_requested");
    assert.ok(approvalEvent, "Should have approval_requested event");

    // Process through gate
    const decision = gate.process({
      providerRef: ref,
      requestId: "req-100",
      kind: "tool",
      reason: "exec npm test",
    });

    assert.equal(decision.requestId, "req-100");
    assert.equal(decision.decision, "allow");

    // Verify the decision is recorded in the ledger
    const sessionRecord = ledger.findByProviderSession(ref.providerSessionId);
    assert.ok(sessionRecord, "Session record should exist");
    assert.equal(sessionRecord.state, "running", "State should be running after allow");
  });

  it("ProviderApprovalGate with DenyNetworkPolicy denies network requests", async () => {
    const ref = await rt.start({
      prompt: "fetch data",
      cwd: "/tmp",
      sessionId: "approval-3",
    });

    ledger.upsert({
      quorumSessionId: "qs-2",
      providerRef: ref,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });

    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new DenyNetworkPolicy());

    const decision = gate.process({
      providerRef: ref,
      requestId: "req-200",
      kind: "network",
      reason: "fetch https://api.example.com",
    });

    assert.equal(decision.decision, "deny");

    const sessionRecord = ledger.findByProviderSession(ref.providerSessionId);
    assert.equal(sessionRecord.state, "failed", "State should be failed after deny");
  });

  it("fail-closed: no policies means deny", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "approval-4",
    });

    ledger.upsert({
      quorumSessionId: "qs-3",
      providerRef: ref,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });

    // Gate with no policies
    const gate = new ProviderApprovalGate(ledger);

    const result = gate.evaluate({
      providerRef: ref,
      requestId: "req-300",
      kind: "tool",
      reason: "exec rm -rf /",
    });

    assert.equal(result.decision, "deny");
    assert.equal(result.decidedBy, "default");
  });

  it("approval is recorded and resolvable in ledger", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "approval-5",
    });

    ledger.upsert({
      quorumSessionId: "qs-4",
      providerRef: ref,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });

    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    gate.process({
      providerRef: ref,
      requestId: "req-400",
      kind: "command",
      reason: "npm install",
    });

    // Check that the approval was resolved in the ledger
    const pending = ledger.pendingApprovals(ref.providerSessionId);
    assert.equal(pending.length, 0, "No pending approvals after resolution");
  });

  it("policy chain: first non-defer wins", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "approval-6",
    });

    const gate = new ProviderApprovalGate(ledger);
    // ScopeBasedPolicy defers for non-tool or no allowedTools
    gate.addPolicy(new ScopeBasedPolicy());
    // DenyNetworkPolicy only triggers for "network" kind
    gate.addPolicy(new DenyNetworkPolicy());
    // AllowAllPolicy catches everything else
    gate.addPolicy(new AllowAllPolicy());

    // Tool request: ScopeBasedPolicy defers (no session), DenyNetworkPolicy defers, AllowAllPolicy allows
    const result = gate.evaluate({
      providerRef: ref,
      requestId: "req-500",
      kind: "tool",
      reason: "exec test",
    });
    assert.equal(result.decision, "allow");
    assert.equal(result.decidedBy, "allow-all");

    // Network request: ScopeBasedPolicy defers, DenyNetworkPolicy denies
    const netResult = gate.evaluate({
      providerRef: ref,
      requestId: "req-501",
      kind: "network",
      reason: "fetch data",
    });
    assert.equal(netResult.decision, "deny");
    assert.equal(netResult.decidedBy, "deny-network");
  });
});

// ═══════════════════════════════════════════════════════
// 4. Fallback contract
// ═══════════════════════════════════════════════════════

describe("Fallback contract", () => {
  it("isAvailable() returns false when codex binary is not available", async () => {
    const rt = new CodexAppServerRuntime("nonexistent-codex-binary-xyz-123");
    const available = await rt.isAvailable();
    assert.equal(available, false);
  });

  it("app_server runtime and one-shot auditor coexist", async () => {
    // App Server runtime with fake binary
    const appServerRt = new CodexAppServerRuntime("nonexistent-codex-binary-xyz-456");
    const appServerAvailable = await appServerRt.isAvailable();
    assert.equal(appServerAvailable, false);

    // The testable runtime (using fake client) works independently
    const testRt = new TestableCodexAppServerRuntime();
    const ref = await testRt.start({
      prompt: "test coexistence",
      cwd: "/tmp",
      sessionId: "fallback-coexist",
    });
    assert.equal(ref.provider, "codex");
    assert.equal(await testRt.status(ref), "running");

    // Clean up
    await testRt.stop(ref);
    assert.equal(await testRt.status(ref), "detached");
  });

  it("app_server properties are correct when binary is unavailable", async () => {
    const rt = new CodexAppServerRuntime("nonexistent-codex-binary-xyz-789");
    assert.equal(rt.provider, "codex");
    assert.equal(rt.mode, "app_server");

    // isAvailable returns false but properties remain correct
    assert.equal(await rt.isAvailable(), false);
  });
});

// ═══════════════════════════════════════════════════════
// 5. Session lifecycle contract
// ═══════════════════════════════════════════════════════

describe("Session lifecycle contract", () => {
  let rt;

  beforeEach(() => {
    rt = new TestableCodexAppServerRuntime();
  });

  it("start() creates a session with status 'running'", async () => {
    const ref = await rt.start({
      prompt: "implement feature",
      cwd: "/tmp/myproject",
      sessionId: "lc-1",
    });

    assert.equal(ref.provider, "codex");
    assert.equal(ref.executionMode, "app_server");
    assert.ok(ref.providerSessionId.includes("lc-1"));
    assert.ok(ref.threadId);
    assert.equal(await rt.status(ref), "running");
  });

  it("poll() returns empty before any notifications", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-2",
    });

    const events = await rt.poll(ref);
    assert.deepEqual(events, []);
  });

  it("notifications update the event queue (visible via poll)", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-3",
    });

    rt.simulateNotification(CODEX_NOTIFICATIONS.THREAD_STARTED, {
      threadId: ref.threadId,
      createdAt: Date.now(),
    });

    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: ref.threadId,
      turnId: "t1",
      itemId: "i1",
      delta: "output chunk",
    });

    const events = await rt.poll(ref);
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "thread_started");
    assert.equal(events[1].kind, "item_delta");
    assert.equal(events[1].payload.delta, "output chunk");
  });

  it("poll() drains the queue (second call returns empty)", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-4",
    });

    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: ref.threadId,
      turnId: "t1",
      itemId: "i1",
      delta: "data",
    });

    const first = await rt.poll(ref);
    assert.equal(first.length, 1);

    const second = await rt.poll(ref);
    assert.equal(second.length, 0);
  });

  it("session_completed notification changes status to 'completed'", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-5",
    });

    assert.equal(await rt.status(ref), "running");

    rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_COMPLETED, {
      threadId: ref.threadId,
      summary: "all done",
    });

    assert.equal(await rt.status(ref), "completed");

    // The completion event should be visible in poll
    const events = await rt.poll(ref);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "session_completed");
    assert.equal(events[0].payload.summary, "all done");
  });

  it("session_failed notification changes status to 'failed'", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-6",
    });

    assert.equal(await rt.status(ref), "running");

    rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_FAILED, {
      threadId: ref.threadId,
      error: "out of tokens",
    });

    assert.equal(await rt.status(ref), "failed");

    const events = await rt.poll(ref);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "session_failed");
    assert.equal(events[0].payload.error, "out of tokens");
  });

  it("stop() changes status to 'detached'", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-7",
    });

    assert.equal(await rt.status(ref), "running");

    await rt.stop(ref);

    assert.equal(await rt.status(ref), "detached");
  });

  it("disconnect() detaches all sessions", async () => {
    const ref1 = await rt.start({
      prompt: "task A",
      cwd: "/tmp",
      sessionId: "lc-8a",
    });
    const ref2 = await rt.start({
      prompt: "task B",
      cwd: "/tmp",
      sessionId: "lc-8b",
    });
    const ref3 = await rt.start({
      prompt: "task C",
      cwd: "/tmp",
      sessionId: "lc-8c",
    });

    assert.equal(await rt.status(ref1), "running");
    assert.equal(await rt.status(ref2), "running");
    assert.equal(await rt.status(ref3), "running");

    await rt.disconnect();

    assert.equal(await rt.status(ref1), "detached");
    assert.equal(await rt.status(ref2), "detached");
    assert.equal(await rt.status(ref3), "detached");
  });

  it("stop() is idempotent", async () => {
    const ref = await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-9",
    });

    await rt.stop(ref);
    assert.equal(await rt.status(ref), "detached");

    // Second stop should not throw
    await rt.stop(ref);
    assert.equal(await rt.status(ref), "detached");
  });

  it("multiple sessions route notifications independently", async () => {
    const ref1 = await rt.start({
      prompt: "task 1",
      cwd: "/tmp",
      sessionId: "lc-10a",
    });
    const ref2 = await rt.start({
      prompt: "task 2",
      cwd: "/tmp",
      sessionId: "lc-10b",
    });

    // Send different notifications to each
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: ref1.threadId,
      turnId: "t1",
      itemId: "i1",
      delta: "output for session 1",
    });
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: ref2.threadId,
      turnId: "t1",
      itemId: "i2",
      delta: "output for session 2",
    });

    const events1 = await rt.poll(ref1);
    const events2 = await rt.poll(ref2);

    assert.equal(events1.length, 1);
    assert.equal(events2.length, 1);
    assert.equal(events1[0].payload.delta, "output for session 1");
    assert.equal(events2[0].payload.delta, "output for session 2");
  });

  it("completing one session does not affect others", async () => {
    const ref1 = await rt.start({
      prompt: "task 1",
      cwd: "/tmp",
      sessionId: "lc-11a",
    });
    const ref2 = await rt.start({
      prompt: "task 2",
      cwd: "/tmp",
      sessionId: "lc-11b",
    });

    rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_COMPLETED, {
      threadId: ref1.threadId,
    });

    assert.equal(await rt.status(ref1), "completed");
    assert.equal(await rt.status(ref2), "running");
  });

  it("status() returns 'detached' for unknown session", async () => {
    const status = await rt.status({
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "nonexistent-session",
    });
    assert.equal(status, "detached");
  });

  it("poll() returns empty for unknown session", async () => {
    const events = await rt.poll({
      provider: "codex",
      executionMode: "app_server",
      providerSessionId: "nonexistent-session",
    });
    assert.deepEqual(events, []);
  });

  it("notifications for unknown threads are ignored silently", async () => {
    await rt.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "lc-12",
    });

    // Should not throw
    rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
      threadId: "ghost-thread",
      turnId: "t1",
      itemId: "i1",
      delta: "invisible",
    });
  });
});

// ═══════════════════════════════════════════════════════
// Integrated: Approval → Ledger → Gate round-trip
// ═══════════════════════════════════════════════════════

describe("Integrated approval round-trip", () => {
  it("runtime approval event → gate process → ledger state", async () => {
    const rt = new TestableCodexAppServerRuntime();
    const ledger = new InMemorySessionLedger();

    // 1. Start a session
    const ref = await rt.start({
      prompt: "implement and test",
      cwd: "/tmp/project",
      sessionId: "roundtrip-1",
    });

    // 2. Register in ledger
    ledger.upsert({
      quorumSessionId: "q-roundtrip-1",
      providerRef: ref,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });

    // 3. Create gate with allow-all
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new AllowAllPolicy());

    // 4. Simulate approval request from runtime
    rt.simulateNotification(CODEX_NOTIFICATIONS.APPROVAL_REQUESTED, {
      threadId: ref.threadId,
      requestId: "roundtrip-req-1",
      kind: "command",
      reason: "npm test",
    });

    // 5. Poll to get the event
    const events = await rt.poll(ref);
    assert.equal(events.length, 1);
    const approvalEvent = events[0];
    assert.equal(approvalEvent.kind, "approval_requested");

    // 6. Process through gate
    const decision = gate.process({
      providerRef: ref,
      requestId: approvalEvent.payload.requestId,
      kind: approvalEvent.payload.kind,
      reason: approvalEvent.payload.reason,
    });

    assert.equal(decision.decision, "allow");
    assert.equal(decision.requestId, "roundtrip-req-1");

    // 7. Verify ledger state
    const record = ledger.findByQuorumSession("q-roundtrip-1");
    assert.ok(record);
    assert.equal(record.state, "running");

    // 8. No pending approvals
    const pending = ledger.pendingApprovals(ref.providerSessionId);
    assert.equal(pending.length, 0);
  });

  it("denied approval transitions ledger state to failed", async () => {
    const rt = new TestableCodexAppServerRuntime();
    const ledger = new InMemorySessionLedger();

    const ref = await rt.start({
      prompt: "fetch external",
      cwd: "/tmp",
      sessionId: "roundtrip-2",
    });

    ledger.upsert({
      quorumSessionId: "q-roundtrip-2",
      providerRef: ref,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      state: "running",
    });

    // Gate with deny-network only
    const gate = new ProviderApprovalGate(ledger);
    gate.addPolicy(new DenyNetworkPolicy());

    const decision = gate.process({
      providerRef: ref,
      requestId: "roundtrip-req-2",
      kind: "network",
      reason: "curl https://evil.com",
    });

    assert.equal(decision.decision, "deny");

    const record = ledger.findByQuorumSession("q-roundtrip-2");
    assert.equal(record.state, "failed");
  });
});
