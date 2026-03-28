/**
 * Tests for CodexAppServerRuntime.
 *
 * Uses a TestableCodexAppServerRuntime subclass that bypasses the real
 * Codex binary — all tests run without codex installed.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Dynamic import of compiled modules ────────────────
const { CodexAppServerRuntime } = await import(
  "../dist/platform/providers/codex/app-server/runtime.js"
);
const { CodexAppServerMapper } = await import(
  "../dist/platform/providers/codex/app-server/mapper.js"
);
const { CODEX_NOTIFICATIONS } = await import(
  "../dist/platform/providers/codex/app-server/protocol.js"
);

// ─── Testable subclass ────────────────────────────────
// Bypasses the real CodexAppServerClient so no binary is needed.

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
    // Call super with defaults (the real client constructor runs but we replace it)
    super("codex", ["--app-server"], 30000);
    // Replace the real client with FakeClient
    const fake = new FakeClient();
    this.client = fake;
    // Re-wire notification listener to the fake client
    fake.on("notification", (notification) => {
      this.handleNotification(notification);
    });
  }

  /** Expose the fake client for test assertions. */
  get fakeClient() {
    return this.client;
  }

  /** Simulate a server notification (push through the fake client). */
  simulateNotification(method, params = {}) {
    this.fakeClient.emit("notification", {
      jsonrpc: "2.0",
      method,
      params,
    });
  }
}

// ─── Tests ────────────────────────────────────────────

describe("CodexAppServerRuntime", () => {
  describe("static properties", () => {
    it("provider is 'codex'", () => {
      const rt = new TestableCodexAppServerRuntime();
      assert.equal(rt.provider, "codex");
    });

    it("mode is 'app_server'", () => {
      const rt = new TestableCodexAppServerRuntime();
      assert.equal(rt.mode, "app_server");
    });
  });

  describe("constructor", () => {
    it("accepts optional binaryPath, args, timeout without throwing", () => {
      // Just verify construction doesn't throw (the real client is replaced anyway)
      assert.doesNotThrow(() => new TestableCodexAppServerRuntime());
    });
  });

  describe("isAvailable()", () => {
    it("returns false when codex binary is not installed", async () => {
      const rt = new CodexAppServerRuntime("nonexistent-codex-binary-xyz");
      const available = await rt.isAvailable();
      assert.equal(available, false);
    });
  });

  describe("session lifecycle", () => {
    let rt;

    beforeEach(() => {
      rt = new TestableCodexAppServerRuntime();
    });

    it("start() returns ProviderSessionRef with threadId", async () => {
      const ref = await rt.start({
        prompt: "fix the bug",
        cwd: "/tmp/project",
        sessionId: "test-001",
      });

      assert.equal(ref.provider, "codex");
      assert.equal(ref.executionMode, "app_server");
      assert.ok(ref.providerSessionId.startsWith("codex-as-test-001-"));
      assert.equal(ref.threadId, "thread-1");
    });

    it("start() connects client if not connected", async () => {
      assert.equal(rt.fakeClient.connected, false);

      await rt.start({
        prompt: "hello",
        cwd: "/tmp",
        sessionId: "s1",
      });

      assert.equal(rt.fakeClient.connected, true);
    });

    it("start() does not reconnect if already connected", async () => {
      await rt.fakeClient.connect();
      assert.equal(rt.fakeClient.connected, true);

      const ref = await rt.start({
        prompt: "hello",
        cwd: "/tmp",
        sessionId: "s2",
      });

      assert.equal(rt.fakeClient.connected, true);
      assert.ok(ref.threadId);
    });

    it("status() returns 'running' after start", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "s3",
      });

      const s = await rt.status(ref);
      assert.equal(s, "running");
    });

    it("status() returns 'detached' for unknown session", async () => {
      const s = await rt.status({
        provider: "codex",
        executionMode: "app_server",
        providerSessionId: "nonexistent",
      });
      assert.equal(s, "detached");
    });

    it("send() throws for unknown session", async () => {
      await assert.rejects(
        () =>
          rt.send(
            {
              provider: "codex",
              executionMode: "app_server",
              providerSessionId: "nonexistent",
            },
            "input",
          ),
        { message: /Session not found/ },
      );
    });

    it("send() throws when session is not running", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "s4",
      });

      await rt.stop(ref);

      await assert.rejects(() => rt.send(ref, "more input"), {
        message: /Cannot send to detached session/,
      });
    });

    it("send() throws when no threadId", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "s5",
      });

      // Manually remove threadId to test the guard
      const noThreadRef = { ...ref, threadId: undefined };

      await assert.rejects(() => rt.send(noThreadRef, "input"), {
        message: /No threadId for send/,
      });
    });

    it("send() succeeds for running session with threadId", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "s6",
      });

      // Should not throw
      await rt.send(ref, "do something");
    });

    it("stop() is idempotent", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "s7",
      });

      await rt.stop(ref);
      assert.equal(await rt.status(ref), "detached");

      // Second stop should not throw
      await rt.stop(ref);
      assert.equal(await rt.status(ref), "detached");
    });

    it("stop() is no-op for unknown session", async () => {
      // Should not throw
      await rt.stop({
        provider: "codex",
        executionMode: "app_server",
        providerSessionId: "nonexistent",
      });
    });

    it("poll() returns empty initially", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "s8",
      });

      const events = await rt.poll(ref);
      assert.deepEqual(events, []);
    });

    it("poll() returns empty for unknown session", async () => {
      const events = await rt.poll({
        provider: "codex",
        executionMode: "app_server",
        providerSessionId: "nonexistent",
      });
      assert.deepEqual(events, []);
    });
  });

  describe("resume", () => {
    let rt;

    beforeEach(() => {
      rt = new TestableCodexAppServerRuntime();
    });

    it("throws for unknown session", async () => {
      await assert.rejects(
        () =>
          rt.resume({
            provider: "codex",
            executionMode: "app_server",
            providerSessionId: "nonexistent",
          }),
        { message: /Session not found/ },
      );
    });

    it("throws for completed session", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "r1",
      });

      // Simulate completion
      rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_COMPLETED, {
        threadId: ref.threadId,
      });

      await assert.rejects(() => rt.resume(ref), {
        message: /Cannot resume completed session/,
      });
    });

    it("throws for failed session", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "r2",
      });

      // Simulate failure
      rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_FAILED, {
        threadId: ref.threadId,
        error: "out of memory",
      });

      await assert.rejects(() => rt.resume(ref), {
        message: /Cannot resume failed session/,
      });
    });

    it("sets status back to running for detached session", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "r3",
      });

      await rt.stop(ref);
      assert.equal(await rt.status(ref), "detached");

      await rt.resume(ref);
      assert.equal(await rt.status(ref), "running");
    });

    it("sends prompt when provided with threadId", async () => {
      const ref = await rt.start({
        prompt: "initial",
        cwd: "/tmp",
        sessionId: "r4",
      });

      await rt.stop(ref);
      // Resume with new prompt
      await rt.resume(ref, { prompt: "continue from here" });
      assert.equal(await rt.status(ref), "running");
    });
  });

  describe("notification handling", () => {
    let rt;

    beforeEach(() => {
      rt = new TestableCodexAppServerRuntime();
    });

    it("session_completed notification changes status to 'completed'", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "n1",
      });

      assert.equal(await rt.status(ref), "running");

      rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_COMPLETED, {
        threadId: ref.threadId,
        summary: "done",
      });

      assert.equal(await rt.status(ref), "completed");
    });

    it("session_failed notification changes status to 'failed'", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "n2",
      });

      rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_FAILED, {
        threadId: ref.threadId,
        error: "oops",
      });

      assert.equal(await rt.status(ref), "failed");
    });

    it("notifications are queued and returned by poll()", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "n3",
      });

      rt.simulateNotification(CODEX_NOTIFICATIONS.THREAD_STARTED, {
        threadId: ref.threadId,
        createdAt: Date.now(),
      });

      rt.simulateNotification(CODEX_NOTIFICATIONS.TURN_STARTED, {
        threadId: ref.threadId,
        turnId: "turn-1",
        role: "assistant",
      });

      const events = await rt.poll(ref);
      assert.equal(events.length, 2);
      assert.equal(events[0].kind, "thread_started");
      assert.equal(events[1].kind, "turn_started");
    });

    it("poll() drains events (second call returns empty)", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "n4",
      });

      rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
        threadId: ref.threadId,
        turnId: "t1",
        itemId: "i1",
        delta: "hello",
      });

      const first = await rt.poll(ref);
      assert.equal(first.length, 1);

      const second = await rt.poll(ref);
      assert.equal(second.length, 0);
    });

    it("notifications for unknown threads are ignored", async () => {
      await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "n5",
      });

      // Notification with a threadId that doesn't match any session
      rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_STARTED, {
        threadId: "unknown-thread",
        turnId: "t1",
        itemId: "i1",
        kind: "message",
      });

      // No crash, and the event is not routed to any session
    });

    it("all notification types produce correctly typed events", async () => {
      const ref = await rt.start({
        prompt: "test",
        cwd: "/tmp",
        sessionId: "n6",
      });

      const tid = ref.threadId;

      rt.simulateNotification(CODEX_NOTIFICATIONS.THREAD_STARTED, { threadId: tid, createdAt: 1 });
      rt.simulateNotification(CODEX_NOTIFICATIONS.TURN_STARTED, { threadId: tid, turnId: "t1", role: "assistant" });
      rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_STARTED, { threadId: tid, turnId: "t1", itemId: "i1", kind: "message" });
      rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, { threadId: tid, turnId: "t1", itemId: "i1", delta: "chunk" });
      rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_COMPLETED, { threadId: tid, turnId: "t1", itemId: "i1", kind: "message", status: "completed" });
      rt.simulateNotification(CODEX_NOTIFICATIONS.TURN_COMPLETED, { threadId: tid, turnId: "t1", itemCount: 1 });
      rt.simulateNotification(CODEX_NOTIFICATIONS.APPROVAL_REQUESTED, { threadId: tid, requestId: "req-1", kind: "tool", reason: "exec npm test" });

      const events = await rt.poll(ref);
      assert.equal(events.length, 7);

      const kinds = events.map((e) => e.kind);
      assert.deepEqual(kinds, [
        "thread_started",
        "turn_started",
        "item_started",
        "item_delta",
        "item_completed",
        "turn_completed",
        "approval_requested",
      ]);

      // All events should have providerRef pointing to the correct session
      for (const ev of events) {
        assert.equal(ev.providerRef.provider, "codex");
        assert.equal(ev.providerRef.providerSessionId, ref.providerSessionId);
        assert.ok(ev.ts > 0);
      }
    });
  });

  describe("disconnect", () => {
    it("detaches all sessions", async () => {
      const rt = new TestableCodexAppServerRuntime();

      const ref1 = await rt.start({
        prompt: "a",
        cwd: "/tmp",
        sessionId: "d1",
      });
      const ref2 = await rt.start({
        prompt: "b",
        cwd: "/tmp",
        sessionId: "d2",
      });

      assert.equal(await rt.status(ref1), "running");
      assert.equal(await rt.status(ref2), "running");

      await rt.disconnect();

      assert.equal(await rt.status(ref1), "detached");
      assert.equal(await rt.status(ref2), "detached");
    });

    it("disconnects the client", async () => {
      const rt = new TestableCodexAppServerRuntime();
      await rt.fakeClient.connect();
      assert.equal(rt.fakeClient.connected, true);

      await rt.disconnect();
      assert.equal(rt.fakeClient.connected, false);
    });
  });

  describe("multiple sessions", () => {
    it("routes notifications to the correct session", async () => {
      const rt = new TestableCodexAppServerRuntime();

      const ref1 = await rt.start({
        prompt: "task 1",
        cwd: "/tmp",
        sessionId: "m1",
      });
      const ref2 = await rt.start({
        prompt: "task 2",
        cwd: "/tmp",
        sessionId: "m2",
      });

      // Send notification to thread-1 (ref1)
      rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
        threadId: ref1.threadId,
        turnId: "t1",
        itemId: "i1",
        delta: "for session 1",
      });

      // Send notification to thread-2 (ref2)
      rt.simulateNotification(CODEX_NOTIFICATIONS.ITEM_DELTA, {
        threadId: ref2.threadId,
        turnId: "t1",
        itemId: "i2",
        delta: "for session 2",
      });

      const events1 = await rt.poll(ref1);
      const events2 = await rt.poll(ref2);

      assert.equal(events1.length, 1);
      assert.equal(events2.length, 1);
      assert.equal(events1[0].payload.delta, "for session 1");
      assert.equal(events2[0].payload.delta, "for session 2");
    });

    it("completing one session does not affect others", async () => {
      const rt = new TestableCodexAppServerRuntime();

      const ref1 = await rt.start({
        prompt: "task 1",
        cwd: "/tmp",
        sessionId: "m3",
      });
      const ref2 = await rt.start({
        prompt: "task 2",
        cwd: "/tmp",
        sessionId: "m4",
      });

      rt.simulateNotification(CODEX_NOTIFICATIONS.SESSION_COMPLETED, {
        threadId: ref1.threadId,
      });

      assert.equal(await rt.status(ref1), "completed");
      assert.equal(await rt.status(ref2), "running");
    });
  });
});
