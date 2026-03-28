import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Import the compiled modules
const { ClaudeSdkSessionApi } = await import(
  "../dist/platform/providers/claude-sdk/session-api.js"
);
const { ClaudeSdkRuntime } = await import(
  "../dist/platform/providers/claude-sdk/runtime.js"
);

// ── ClaudeSdkSessionApi ─────────────────────────────────

describe("ClaudeSdkSessionApi", () => {
  /** @type {InstanceType<typeof ClaudeSdkSessionApi>} */
  let api;

  beforeEach(() => {
    api = new ClaudeSdkSessionApi();
  });

  it("isAvailable() returns false (SDK not installed)", async () => {
    const available = await api.isAvailable();
    assert.equal(available, false);
  });

  it("listSessions() returns empty array when SDK not available", async () => {
    const sessions = await api.listSessions();
    assert.deepStrictEqual(sessions, []);
  });

  it("getSession() returns unknown status when SDK not available", async () => {
    const info = await api.getSession("test-session-123");
    assert.equal(info.sessionId, "test-session-123");
    assert.equal(info.status, "unknown");
  });

  it("getMessageCount() returns 0 when SDK not available", async () => {
    const count = await api.getMessageCount("test-session-123");
    assert.equal(count, 0);
  });

  it("ensureLoaded() caches result", async () => {
    const result1 = await api.ensureLoaded();
    const result2 = await api.ensureLoaded();
    assert.strictEqual(result1, result2); // same reference
    assert.equal(result1.available, false);
  });
});

// ── ClaudeSdkRuntime ────────────────────────────────────

describe("ClaudeSdkRuntime", () => {
  /** @type {InstanceType<typeof ClaudeSdkRuntime>} */
  let runtime;

  beforeEach(() => {
    runtime = new ClaudeSdkRuntime();
  });

  it('provider is "claude"', () => {
    assert.equal(runtime.provider, "claude");
  });

  it('mode is "agent_sdk"', () => {
    assert.equal(runtime.mode, "agent_sdk");
  });

  it("isAvailable() returns false when SDK not installed", async () => {
    const available = await runtime.isAvailable();
    assert.equal(available, false);
  });

  it("start() throws when SDK not available", async () => {
    await assert.rejects(
      () =>
        runtime.start({
          prompt: "test",
          cwd: "/tmp",
          sessionId: "s-1",
        }),
      {
        message: /Claude Agent SDK is not available/,
      }
    );
  });

  it("status() returns 'detached' for unknown session", async () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "nonexistent",
    };
    const s = await runtime.status(ref);
    assert.equal(s, "detached");
  });

  it("poll() returns empty for unknown session", async () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "nonexistent",
    };
    const events = await runtime.poll(ref);
    assert.deepStrictEqual(events, []);
  });

  it("stop() is idempotent for unknown session", async () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "nonexistent",
    };
    // Should not throw
    await runtime.stop(ref);
  });
});

// ── ClaudeSdkRuntime (with mocked availability) ─────────

/**
 * Subclass that overrides isAvailable() to return true,
 * allowing us to test session lifecycle without the actual SDK.
 */
class TestableClaudeSdkRuntime extends ClaudeSdkRuntime {
  async isAvailable() {
    return true;
  }
}

describe("ClaudeSdkRuntime (mocked available)", () => {
  /** @type {InstanceType<typeof TestableClaudeSdkRuntime>} */
  let runtime;

  beforeEach(() => {
    runtime = new TestableClaudeSdkRuntime();
  });

  it("start() returns ProviderSessionRef with correct shape", async () => {
    const ref = await runtime.start({
      prompt: "test prompt",
      cwd: "/tmp",
      sessionId: "s-1",
    });
    assert.equal(ref.provider, "claude");
    assert.equal(ref.executionMode, "agent_sdk");
    assert.ok(ref.providerSessionId.startsWith("claude-sdk-s-1-"));
    assert.equal(typeof ref.providerSessionId, "string");
  });

  it('status() returns "running" after start', async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-2",
    });
    const s = await runtime.status(ref);
    assert.equal(s, "running");
  });

  it("send() works on running session", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-3",
    });
    // Should not throw
    await runtime.send(ref, "hello");
  });

  it("send() throws on non-running session", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-4",
    });
    await runtime.stop(ref);
    await assert.rejects(() => runtime.send(ref, "hello"), {
      message: /Cannot send to detached session/,
    });
  });

  it("send() throws on unknown session", async () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "nonexistent",
    };
    await assert.rejects(() => runtime.send(ref, "hello"), {
      message: /Session not found/,
    });
  });

  it('stop() changes status to "detached"', async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-5",
    });
    await runtime.stop(ref);
    const s = await runtime.status(ref);
    assert.equal(s, "detached");
  });

  it("stop() is idempotent (no error for unknown session)", async () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "nonexistent",
    };
    await runtime.stop(ref);
    // No error
  });

  it("resume() works on running session", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-6",
    });
    // Should not throw
    await runtime.resume(ref);
  });

  it("resume() works on detached session", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-6b",
    });
    await runtime.stop(ref);
    assert.equal(await runtime.status(ref), "detached");
    // Detached sessions can be resumed (re-attached)
    await runtime.resume(ref);
    assert.equal(await runtime.status(ref), "running");
  });

  it("resume() throws on completed session", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-7",
    });
    runtime.complete(ref.providerSessionId);
    await assert.rejects(() => runtime.resume(ref), {
      message: /Cannot resume completed session/,
    });
  });

  it("resume() throws on failed session", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-7b",
    });
    runtime.fail(ref.providerSessionId);
    await assert.rejects(() => runtime.resume(ref), {
      message: /Cannot resume failed session/,
    });
  });

  it("resume() throws on unknown session", async () => {
    const ref = {
      provider: "claude",
      executionMode: "agent_sdk",
      providerSessionId: "nonexistent",
    };
    await assert.rejects(() => runtime.resume(ref), {
      message: /Session not found/,
    });
  });

  it("poll() returns empty initially", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-8",
    });
    const events = await runtime.poll(ref);
    assert.deepStrictEqual(events, []);
  });

  it("poll() returns events after pushEvent, then drains", async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-9",
    });

    const event1 = {
      providerRef: ref,
      kind: "turn_started",
      payload: { turnIndex: 0 },
      ts: Date.now(),
    };
    const event2 = {
      providerRef: ref,
      kind: "item_completed",
      payload: { itemId: "x" },
      ts: Date.now(),
    };

    runtime.pushEvent(ref.providerSessionId, event1);
    runtime.pushEvent(ref.providerSessionId, event2);

    const events = await runtime.poll(ref);
    assert.equal(events.length, 2);
    assert.deepStrictEqual(events[0], event1);
    assert.deepStrictEqual(events[1], event2);

    // Second poll should be empty (drained)
    const events2 = await runtime.poll(ref);
    assert.deepStrictEqual(events2, []);
  });

  it('complete() changes status to "completed"', async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-10",
    });
    runtime.complete(ref.providerSessionId);
    const s = await runtime.status(ref);
    assert.equal(s, "completed");
  });

  it('fail() changes status to "failed"', async () => {
    const ref = await runtime.start({
      prompt: "test",
      cwd: "/tmp",
      sessionId: "s-11",
    });
    runtime.fail(ref.providerSessionId);
    const s = await runtime.status(ref);
    assert.equal(s, "failed");
  });
});
