#!/usr/bin/env node
/**
 * RAI-1: Remote State Contract + RAI-2: Approval Callbacks
 *
 * Run: node --test tests/remote-bridge.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  BridgeServer,
  projectRemoteState,
} = await import("../dist/daemon/bridge/server.js");

const {
  ApprovalController,
  signControlMessage,
} = await import("../dist/daemon/bridge/approval-controller.js");

const { InMemorySessionLedger } = await import("../dist/platform/providers/session-ledger.js");
const { ProviderSessionProjector } = await import("../dist/platform/bus/provider-session-projector.js");

// ── Helpers ──────────────────────────────────

function createMockStore() {
  const events = [];
  const kv = new Map();
  return {
    recent: (n) => events.slice(-n),
    getEventsAfter: (ts) => events.filter(e => e.timestamp > ts),
    getDb: () => ({ prepare: () => ({ get: () => undefined }) }),
    getKV: (key) => kv.get(key) ?? null,
    setKV: (key, value) => kv.set(key, value),
    count: () => 0,
    _addEvent: (type, payload) => events.push({ type, timestamp: Date.now(), source: "test", payload }),
    _kv: kv,
  };
}

function createTestLedger() {
  return new InMemorySessionLedger();
}

function createTestProjector(ledger) {
  return new ProviderSessionProjector(ledger);
}

const TEST_SECRET = "test-secret-key-2026";

// ═══ RAI-1: Remote State Contract ═════════════════════

describe("RAI-1: RemoteSessionState model", () => {
  it("projects idle state when no sessions", () => {
    const store = createMockStore();
    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const state = projectRemoteState(store, ledger, projector);
    assert.equal(state.state, "idle");
    assert.equal(state.pendingAction, null);
    assert.ok(state.updatedAt > 0);
    assert.ok(typeof state.latestTaskSummary === "string");
  });

  it("includes recent events in snapshot", () => {
    const store = createMockStore();
    store._addEvent("audit.verdict", { verdict: "approved" });
    store._addEvent("track.progress", { trackId: "T1", total: 5, completed: 3 });

    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const state = projectRemoteState(store, ledger, projector);
    assert.ok(state.recentEvents.length >= 2);
    assert.ok(state.recentEvents.some(e => e.type === "audit.verdict"));
  });

  it("includes active tracks from events", () => {
    const store = createMockStore();
    store._addEvent("track.progress", { trackId: "RAI", total: 10, completed: 4 });

    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const state = projectRemoteState(store, ledger, projector);
    assert.equal(state.activeTracks.length, 1);
    assert.equal(state.activeTracks[0].trackId, "RAI");
    assert.equal(state.activeTracks[0].completed, 4);
  });

  it("includes dream status when KV exists", () => {
    const store = createMockStore();
    store._kv.set("dream:state", {
      consolidationStatus: "ready",
      lastConsolidatedAt: 1700000000000,
    });

    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const state = projectRemoteState(store, ledger, projector);
    assert.ok(state.dreamStatus);
    assert.equal(state.dreamStatus.consolidationStatus, "ready");
    assert.equal(state.dreamStatus.lastConsolidatedAt, 1700000000000);
  });

  it("dream status is null when no KV", () => {
    const store = createMockStore();
    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const state = projectRemoteState(store, ledger, projector);
    assert.equal(state.dreamStatus, null);
  });
});

describe("RAI-1: BridgeServer", () => {
  it("creates snapshot from store + ledger", () => {
    const store = createMockStore();
    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const server = new BridgeServer(store, ledger, projector);
    const snap = server.snapshot();
    assert.equal(snap.state, "idle");
    assert.ok(snap.updatedAt > 0);
  });

  it("isActive returns false without transport", () => {
    const store = createMockStore();
    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const server = new BridgeServer(store, ledger, projector);
    assert.equal(server.isActive(), false);
  });

  it("starts and stops with mock transport", async () => {
    const store = createMockStore();
    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    const broadcasts = [];
    const transport = {
      name: "mock",
      start: async () => {},
      stop: async () => {},
      broadcast: (s) => broadcasts.push(s),
      onControl: () => {},
      clientCount: () => 1,
    };

    const server = new BridgeServer(store, ledger, projector, { pollIntervalMs: 50 });
    await server.start(transport);

    // Wait for at least one poll
    await new Promise(r => setTimeout(r, 100));
    await server.stop();

    assert.ok(broadcasts.length >= 1, "Should have broadcast at least once");
    assert.equal(broadcasts[0].state, "idle");
  });

  it("routes control messages to handlers", async () => {
    const store = createMockStore();
    const ledger = createTestLedger();
    const projector = createTestProjector(ledger);

    let receivedMsg = null;
    const controlHandlers = [];
    const transport = {
      name: "mock",
      start: async () => {},
      stop: async () => {},
      broadcast: () => {},
      onControl: (h) => controlHandlers.push(h),
      clientCount: () => 0,
    };

    const server = new BridgeServer(store, ledger, projector);
    server.onControl((msg) => { receivedMsg = msg; });
    await server.start(transport);

    // Simulate control message through transport
    const msg = { type: "ping", ts: Date.now() };
    for (const h of controlHandlers) h(msg);

    assert.ok(receivedMsg);
    assert.equal(receivedMsg.type, "ping");

    await server.stop();
  });
});

// ═══ RAI-2: Approval Controller ═══════════════════════

describe("RAI-2: ApprovalController — validation", () => {
  it("rejects unsupported message types", () => {
    const ledger = createTestLedger();
    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });

    const result = controller.handleCallback({
      type: "ping",
      requestId: "r1",
      ts: Date.now(),
    });
    assert.equal(result.success, false);
    assert.ok(result.reason.includes("unsupported"));
  });

  it("rejects missing requestId", () => {
    const ledger = createTestLedger();
    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });

    const result = controller.handleCallback({
      type: "approve",
      ts: Date.now(),
    });
    assert.equal(result.success, false);
    assert.ok(result.reason.includes("requestId"));
  });

  it("rejects old callbacks (replay protection)", () => {
    const ledger = createTestLedger();
    const controller = new ApprovalController(ledger, {
      sharedSecret: TEST_SECRET,
      maxCallbackAgeMs: 5000,
    });

    const ts = Date.now() - 10000; // 10s ago
    const sig = signControlMessage(TEST_SECRET, "r1", "approve", ts);
    const result = controller.handleCallback({
      type: "approve",
      requestId: "r1",
      signature: sig,
      ts,
    });
    assert.equal(result.success, false);
    assert.ok(result.reason.includes("too old"));
  });

  it("rejects invalid signature", () => {
    const ledger = createTestLedger();
    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });

    const result = controller.handleCallback({
      type: "approve",
      requestId: "r1",
      signature: "bad-signature",
      ts: Date.now(),
    });
    assert.equal(result.success, false);
    assert.ok(result.reason.includes("invalid signature"));
  });

  it("rejects when no shared secret configured (fail-closed)", () => {
    const ledger = createTestLedger();
    const controller = new ApprovalController(ledger, { sharedSecret: "" });

    const result = controller.handleCallback({
      type: "approve",
      requestId: "r1",
      signature: "any",
      ts: Date.now(),
    });
    assert.equal(result.success, false);
    assert.ok(result.reason.includes("invalid signature"));
  });
});

describe("RAI-2: ApprovalController — resolve", () => {
  it("resolves approval through ledger with valid signature", () => {
    const ledger = createTestLedger();
    // Seed a pending approval
    ledger.recordApproval({
      requestId: "r1",
      providerRef: { provider: "claude", executionMode: "agent_sdk", providerSessionId: "s1" },
      kind: "tool",
      reason: "code_map",
    });

    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });

    const ts = Date.now();
    const sig = signControlMessage(TEST_SECRET, "r1", "approve", ts);
    const result = controller.handleCallback({
      type: "approve",
      requestId: "r1",
      signature: sig,
      ts,
    });
    assert.equal(result.success, true);
    assert.equal(result.decision, "allow");

    // Verify ledger was updated
    const pending = ledger.pendingApprovals("s1");
    assert.equal(pending.length, 0, "Approval should be resolved (no longer pending)");
  });

  it("resolves deny through ledger", () => {
    const ledger = createTestLedger();
    ledger.recordApproval({
      requestId: "r2",
      providerRef: { provider: "codex", executionMode: "cli_exec", providerSessionId: "s2" },
      kind: "network",
      reason: "fetch",
    });

    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });

    const ts = Date.now();
    const sig = signControlMessage(TEST_SECRET, "r2", "deny", ts);
    const result = controller.handleCallback({
      type: "deny",
      requestId: "r2",
      signature: sig,
      ts,
    });
    assert.equal(result.success, true);
    assert.equal(result.decision, "deny");
  });
});

describe("RAI-2: ApprovalController — cancel", () => {
  it("cancels pending approval as deny", () => {
    const ledger = createTestLedger();
    ledger.recordApproval({
      requestId: "r3",
      providerRef: { provider: "claude", executionMode: "cli_exec", providerSessionId: "s3" },
      kind: "diff",
      reason: "write_file",
    });

    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });
    const result = controller.cancelApproval("r3");
    assert.equal(result.success, true);
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "cancelled");
  });
});

describe("RAI-2: ApprovalController — listPending", () => {
  it("lists pending approvals for remote UI", () => {
    const ledger = createTestLedger();
    ledger.recordApproval({
      requestId: "r4",
      providerRef: { provider: "claude", executionMode: "agent_sdk", providerSessionId: "s4" },
      kind: "tool",
      reason: "blast_radius",
    });
    ledger.recordApproval({
      requestId: "r5",
      providerRef: { provider: "claude", executionMode: "agent_sdk", providerSessionId: "s4" },
      kind: "network",
      reason: "fetch_api",
    });

    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });
    const pending = controller.listPending("s4");
    assert.equal(pending.length, 2);
    assert.equal(pending[0].requestId, "r4");
    assert.equal(pending[1].kind, "network");
  });
});

describe("RAI-2: signControlMessage", () => {
  it("produces consistent signatures", () => {
    const sig1 = signControlMessage(TEST_SECRET, "r1", "approve", 1000);
    const sig2 = signControlMessage(TEST_SECRET, "r1", "approve", 1000);
    assert.equal(sig1, sig2);
    assert.ok(sig1.length > 0);
  });

  it("different inputs produce different signatures", () => {
    const sig1 = signControlMessage(TEST_SECRET, "r1", "approve", 1000);
    const sig2 = signControlMessage(TEST_SECRET, "r1", "deny", 1000);
    const sig3 = signControlMessage(TEST_SECRET, "r2", "approve", 1000);
    assert.notEqual(sig1, sig2);
    assert.notEqual(sig1, sig3);
  });
});

// ═══ RAI-1+2: Integration ═════════════════════════════

describe("RAI-1+2: bridge offline fallback", () => {
  it("local ledger continues working without bridge", () => {
    const ledger = createTestLedger();

    // Record and resolve approval without any bridge involvement
    ledger.recordApproval({
      requestId: "local-r1",
      providerRef: { provider: "claude", executionMode: "cli_exec", providerSessionId: "ls1" },
      kind: "tool",
      reason: "code_map",
    });

    assert.equal(ledger.pendingApprovals("ls1").length, 1);
    ledger.resolveApproval("local-r1", "allow");
    assert.equal(ledger.pendingApprovals("ls1").length, 0);
  });

  it("remote decision goes through gate path, not direct", () => {
    // This test validates the architectural invariant:
    // remote callbacks route through ledger.resolveApproval(), never directly to runtime
    const ledger = createTestLedger();
    ledger.recordApproval({
      requestId: "gate-r1",
      providerRef: { provider: "codex", executionMode: "cli_exec", providerSessionId: "gs1" },
      kind: "command",
      reason: "bash",
    });

    const controller = new ApprovalController(ledger, { sharedSecret: TEST_SECRET });
    const ts = Date.now();
    const sig = signControlMessage(TEST_SECRET, "gate-r1", "approve", ts);

    controller.handleCallback({ type: "approve", requestId: "gate-r1", signature: sig, ts });

    // Approval resolved in ledger (gate reads from here)
    const pending = ledger.pendingApprovals("gs1");
    assert.equal(pending.length, 0);
  });
});
