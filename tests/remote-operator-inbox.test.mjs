#!/usr/bin/env node
/**
 * RAI-8: Remote Operator UI + RAI-9: Session Inbox
 *
 * Run: node --test tests/remote-operator-inbox.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  projectStatusView,
  projectApprovalView,
  detectNotifications,
} = await import("../dist/daemon/bridge/client-contract.js");

const { SessionInbox } = await import("../dist/platform/bus/session-inbox.js");

// ═══ RAI-8: Operator UI Contract ══════════════════════

describe("RAI-8: projectStatusView", () => {
  it("projects state into status view", () => {
    const state = makeState({ state: "running", latestTaskSummary: "Building feature X" });
    const view = projectStatusView(state);
    assert.equal(view.state, "running");
    assert.equal(view.summary, "Building feature X");
    assert.ok(view.updatedAt > 0);
  });

  it("includes tracks and dream status", () => {
    const state = makeState({
      activeTracks: [{ trackId: "RAI", total: 10, completed: 5, status: "in_progress" }],
      dreamStatus: { consolidationStatus: "ready", lastConsolidatedAt: 1000, lastDigestSummary: "done" },
    });
    const view = projectStatusView(state);
    assert.equal(view.tracks.length, 1);
    assert.ok(view.dream);
    assert.equal(view.dream.consolidationStatus, "ready");
  });
});

describe("RAI-8: projectApprovalView", () => {
  it("shows pending action", () => {
    const state = makeState({
      pendingAction: { requestId: "r1", kind: "tool", reason: "code_map", tool: "code_map", provider: "claude", sessionId: "s1", createdAt: Date.now() },
    });
    const view = projectApprovalView(state);
    assert.equal(view.pending.length, 1);
    assert.equal(view.pending[0].requestId, "r1");
  });

  it("empty when no pending action", () => {
    const state = makeState({});
    const view = projectApprovalView(state);
    assert.equal(view.pending.length, 0);
  });
});

describe("RAI-8: detectNotifications", () => {
  it("detects new approval", () => {
    const prev = makeState({});
    const curr = makeState({
      state: "requires_action",
      pendingAction: { requestId: "r1", kind: "tool", reason: "bash", tool: "bash", provider: "claude", sessionId: "s1", createdAt: Date.now() },
    });
    const notifs = detectNotifications(prev, curr);
    assert.ok(notifs.some(n => n.type === "approval_required"));
    assert.ok(notifs.find(n => n.type === "approval_required").actionRequired);
  });

  it("detects approval resolved", () => {
    const prev = makeState({
      pendingAction: { requestId: "r1", kind: "tool", reason: "bash", tool: "bash", provider: "claude", sessionId: "s1", createdAt: Date.now() },
    });
    const curr = makeState({});
    const notifs = detectNotifications(prev, curr);
    assert.ok(notifs.some(n => n.type === "approval_resolved"));
  });

  it("detects session idle", () => {
    const prev = makeState({ state: "running" });
    const curr = makeState({ state: "idle" });
    const notifs = detectNotifications(prev, curr);
    assert.ok(notifs.some(n => n.type === "session_idle"));
  });

  it("detects session active", () => {
    const prev = makeState({ state: "idle" });
    const curr = makeState({ state: "running" });
    const notifs = detectNotifications(prev, curr);
    assert.ok(notifs.some(n => n.type === "session_active"));
  });

  it("detects dream completed", () => {
    const prev = makeState({ dreamStatus: { consolidationStatus: "running", lastConsolidatedAt: null, lastDigestSummary: null } });
    const curr = makeState({ dreamStatus: { consolidationStatus: "ready", lastConsolidatedAt: Date.now(), lastDigestSummary: "3 constraints" } });
    const notifs = detectNotifications(prev, curr);
    assert.ok(notifs.some(n => n.type === "dream_completed"));
  });

  it("no notifications when nothing changed", () => {
    const state = makeState({});
    const notifs = detectNotifications(state, state);
    assert.equal(notifs.length, 0);
  });

  it("handles null previous state (first snapshot)", () => {
    const curr = makeState({ state: "idle" });
    const notifs = detectNotifications(null, curr);
    // No crash; may or may not produce notifications depending on initial state
    assert.ok(Array.isArray(notifs));
  });
});

// ═══ RAI-9: Session Inbox ═════════════════════════════

describe("RAI-9: SessionInbox — send and drain", () => {
  it("sends and drains messages", () => {
    const inbox = new SessionInbox();
    inbox.send({ from: "s1", to: "s2", body: "hello" });
    inbox.send({ from: "s1", to: "s2", body: "world" });

    const messages = inbox.drain("s2");
    assert.equal(messages.length, 2);
    assert.equal(messages[0].body, "hello");
    assert.ok(messages[0].deliveredAt > 0);

    // Second drain should be empty
    const again = inbox.drain("s2");
    assert.equal(again.length, 0);
  });

  it("queues are per-recipient", () => {
    const inbox = new SessionInbox();
    inbox.send({ from: "s1", to: "s2", body: "for s2" });
    inbox.send({ from: "s1", to: "s3", body: "for s3" });

    assert.equal(inbox.drain("s2").length, 1);
    assert.equal(inbox.drain("s3").length, 1);
    assert.equal(inbox.drain("s4").length, 0);
  });

  it("enforces per-recipient bounds", () => {
    const inbox = new SessionInbox({ maxPerRecipient: 3, maxAgeMs: 60000 });
    for (let i = 0; i < 10; i++) {
      inbox.send({ from: "s1", to: "s2", body: `msg ${i}` });
    }
    assert.equal(inbox.pendingCount("s2"), 3);
    const messages = inbox.drain("s2");
    assert.equal(messages.length, 3);
    // Should have the latest 3
    assert.equal(messages[0].body, "msg 7");
  });

  it("expires old messages on drain", () => {
    const inbox = new SessionInbox({ maxPerRecipient: 50, maxAgeMs: 100 });
    inbox.send({ from: "s1", to: "s2", body: "old" });

    // Drain after expiry
    const messages = inbox.drain("s2", Date.now() + 200);
    assert.equal(messages.length, 0);
  });

  it("pendingCount reflects queue size", () => {
    const inbox = new SessionInbox();
    assert.equal(inbox.pendingCount("s1"), 0);
    inbox.send({ from: "s2", to: "s1", body: "a" });
    assert.equal(inbox.pendingCount("s1"), 1);
  });

  it("clear removes all queues", () => {
    const inbox = new SessionInbox();
    inbox.send({ from: "s1", to: "s2", body: "a" });
    inbox.send({ from: "s1", to: "s3", body: "b" });
    inbox.clear();
    assert.equal(inbox.pendingCount("s2"), 0);
    assert.equal(inbox.pendingCount("s3"), 0);
  });
});

describe("RAI-9: inbox is async, never sync RPC", () => {
  it("sender does not receive response from send()", () => {
    const inbox = new SessionInbox();
    const result = inbox.send({ from: "s1", to: "s2", body: "request" });
    // send() returns the queued message, NOT a response from receiver
    assert.ok(result.messageId);
    assert.equal(result.deliveredAt, undefined);
  });
});

// ── Helper ───────────────────────────────────

function makeState(overrides) {
  return {
    state: "idle",
    sessionId: "test-session",
    pendingAction: null,
    latestTaskSummary: "No active sessions",
    activeTracks: [],
    recentEvents: [],
    dreamStatus: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}
