#!/usr/bin/env node
/**
 * ProcessMux Tests — cross-platform process multiplexer.
 *
 * Tests raw backend (always available) + API contract.
 * tmux/psmux backends tested only when available.
 *
 * Run: node --test tests/mux.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, after } from "node:test";

const { ProcessMux } = await import("../dist/platform/bus/mux.js");

// ═══ 1. Backend detection ═════════════════════════════════════════════

describe("ProcessMux backend", () => {
  it("auto-detects a backend", () => {
    const mux = new ProcessMux();
    const backend = mux.getBackend();
    assert.ok(["tmux", "psmux", "raw"].includes(backend));
  });

  it("accepts forced raw backend", () => {
    const mux = new ProcessMux("raw");
    assert.equal(mux.getBackend(), "raw");
  });

  it("starts with zero active sessions", () => {
    const mux = new ProcessMux("raw");
    assert.equal(mux.active(), 0);
    assert.deepEqual(mux.list(), []);
  });
});

// ═══ 2. Raw backend spawn/capture/kill ════════════════════════════════

describe("ProcessMux raw backend", () => {
  let mux;

  after(async () => {
    if (mux) await mux.cleanup();
  });

  it("spawns a process and tracks it", async () => {
    mux = new ProcessMux("raw");

    const session = await mux.spawn({
      name: "test-echo",
      command: process.execPath,
      args: ["-e", "setInterval(() => console.log('tick'), 200)"],
    });

    assert.ok(session.id);
    assert.equal(session.name, "test-echo");
    assert.equal(session.backend, "raw");
    assert.equal(session.status, "running");
    assert.ok(session.pid);
    assert.equal(mux.active(), 1);
  });

  it("captures output from running process", async () => {
    // Poll until output appears (Windows process startup can be slow)
    let result;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      result = mux.capture(mux.list()[0].id);
      if (result?.output?.includes("tick")) break;
    }
    assert.ok(result);
    assert.ok(result.output.includes("tick"), `expected "tick" in output, got: ${result.output.slice(0, 100)}`);
    assert.ok(result.lines > 0);
  });

  it("sends input to a running process", async () => {
    const session = mux.list()[0];
    const sent = mux.send(session.id, "hello");
    assert.equal(sent, true);
  });

  it("send returns false for unknown session", () => {
    const sent = mux.send("nonexistent", "test");
    assert.equal(sent, false);
  });

  it("kills a session", async () => {
    const session = mux.list()[0];
    const killed = await mux.kill(session.id);
    assert.equal(killed, true);
    assert.equal(session.status, "stopped");
    assert.equal(mux.active(), 0);
  });

  it("kill returns false for unknown session", async () => {
    const result = await mux.kill("nonexistent");
    assert.equal(result, false);
  });

  it("capture returns null for stopped session", () => {
    const sessions = mux.list();
    if (sessions.length > 0) {
      const result = mux.capture(sessions[0].id);
      assert.equal(result, null);
    }
  });
});

// ═══ 3. Multiple concurrent sessions ══════════════════════════════════

describe("ProcessMux concurrent sessions", () => {
  it("manages multiple sessions independently", async () => {
    const mux = new ProcessMux("raw");

    const s1 = await mux.spawn({
      name: "worker-1",
      command: process.execPath,
      args: ["-e", "console.log('w1'); setTimeout(() => {}, 5000)"],
    });

    const s2 = await mux.spawn({
      name: "worker-2",
      command: process.execPath,
      args: ["-e", "console.log('w2'); setTimeout(() => {}, 5000)"],
    });

    assert.equal(mux.active(), 2);
    assert.equal(mux.list().length, 2);

    await mux.kill(s1.id);
    assert.equal(mux.active(), 1);

    await mux.cleanup();
    assert.equal(mux.active(), 0);
  });
});

// ═══ 4. Event emission ════════════════════════════════════════════════

describe("ProcessMux events", () => {
  it("emits spawn event", async () => {
    const mux = new ProcessMux("raw");
    const events = [];
    mux.on("spawn", (s) => events.push(s));

    await mux.spawn({
      name: "evt-test",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 2000)"],
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].name, "evt-test");

    await mux.cleanup();
  });

  it("emits exit event when process ends", async () => {
    const mux = new ProcessMux("raw");
    const exits = [];
    mux.on("exit", (s, code) => exits.push({ session: s, code }));

    await mux.spawn({
      name: "short-lived",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
    });

    // Wait for process to exit
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(exits.length, 1);
    assert.equal(exits[0].code, 0);

    await mux.cleanup();
  });

  it("emits stop event on kill", async () => {
    const mux = new ProcessMux("raw");
    const stops = [];
    mux.on("stop", (s) => stops.push(s));

    const session = await mux.spawn({
      name: "kill-test",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
    });

    await mux.kill(session.id);
    assert.equal(stops.length, 1);

    await mux.cleanup();
  });
});
