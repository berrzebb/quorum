#!/usr/bin/env node
/**
 * Bus Tests — QuorumBus event pub/sub, ring buffer, JSONL persistence.
 *
 * Run: node --test tests/bus.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { QuorumBus } = await import("../dist/platform/bus/bus.js");
const { createEvent } = await import("../dist/platform/bus/events.js");

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "bus-test-"));
});

after(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

// ═══ 1. Event emission + subscription ══════════════════════════════════

describe("QuorumBus pub/sub", () => {
  it("emits events to type-specific subscribers", () => {
    const bus = new QuorumBus();
    const received = [];
    bus.on("audit.start", (e) => received.push(e));

    bus.emit(createEvent("audit.start", "claude-code", { file: "test.ts" }));
    bus.emit(createEvent("session.start", "claude-code"));

    assert.equal(received.length, 1);
    assert.equal(received[0].type, "audit.start");
    assert.equal(received[0].payload.file, "test.ts");
  });

  it("emits events to wildcard subscribers", () => {
    const bus = new QuorumBus();
    const received = [];
    bus.on("*", (e) => received.push(e));

    bus.emit(createEvent("audit.start", "codex"));
    bus.emit(createEvent("retro.complete", "claude-code"));

    assert.equal(received.length, 2);
  });

  it("supports once() for single-fire subscription", () => {
    const bus = new QuorumBus();
    let count = 0;
    bus.once("audit.verdict", () => count++);

    bus.emit(createEvent("audit.verdict", "codex", { verdict: "approved" }));
    bus.emit(createEvent("audit.verdict", "codex", { verdict: "approved" }));

    assert.equal(count, 1);
  });

  it("supports off() for unsubscription", () => {
    const bus = new QuorumBus();
    let count = 0;
    const handler = () => count++;
    bus.on("audit.start", handler);

    bus.emit(createEvent("audit.start", "codex"));
    bus.off("audit.start", handler);
    bus.emit(createEvent("audit.start", "codex"));

    assert.equal(count, 1);
  });
});

// ═══ 2. Ring buffer ═══════════════════════════════════════════════════

describe("QuorumBus ring buffer", () => {
  it("stores events in recent()", () => {
    const bus = new QuorumBus({ bufferSize: 10 });
    bus.emit(createEvent("audit.start", "claude-code"));
    bus.emit(createEvent("audit.verdict", "codex", { verdict: "approved" }));

    const recent = bus.recent();
    assert.equal(recent.length, 2);
    assert.equal(recent[0].type, "audit.start");
    assert.equal(recent[1].type, "audit.verdict");
  });

  it("limits buffer to bufferSize", () => {
    const bus = new QuorumBus({ bufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      bus.emit(createEvent("agent.progress", "claude-code", { i }));
    }

    const recent = bus.recent();
    assert.equal(recent.length, 3);
    assert.equal(recent[0].payload.i, 2);
    assert.equal(recent[2].payload.i, 4);
  });

  it("filters by type with recentByType()", () => {
    const bus = new QuorumBus();
    bus.emit(createEvent("audit.start", "claude-code"));
    bus.emit(createEvent("agent.spawn", "codex", { name: "impl-1" }));
    bus.emit(createEvent("audit.verdict", "codex"));
    bus.emit(createEvent("agent.spawn", "codex", { name: "impl-2" }));

    const spawns = bus.recentByType("agent.spawn");
    assert.equal(spawns.length, 2);
    assert.equal(spawns[0].payload.name, "impl-1");
  });

  it("clear() empties the buffer", () => {
    const bus = new QuorumBus();
    bus.emit(createEvent("audit.start", "claude-code"));
    bus.clear();
    assert.equal(bus.recent().length, 0);
  });
});

// ═══ 3. JSONL persistence ═════════════════════════════════════════════

describe("QuorumBus JSONL persistence", () => {
  it("persists events to JSONL file", () => {
    const logPath = join(tmpDir, "events.jsonl");
    const bus = new QuorumBus({ logPath });

    bus.emit(createEvent("session.start", "claude-code", { mode: "test" }));
    bus.emit(createEvent("audit.start", "codex"));

    assert.ok(existsSync(logPath));
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.type, "session.start");
    assert.equal(parsed.source, "claude-code");
  });

  it("loadFromLog() recovers events", () => {
    const logPath = join(tmpDir, "recover.jsonl");
    const bus1 = new QuorumBus({ logPath });
    bus1.emit(createEvent("audit.start", "claude-code"));
    bus1.emit(createEvent("audit.verdict", "codex", { verdict: "approved" }));

    // New bus instance — simulates daemon restart
    const bus2 = new QuorumBus({ logPath });
    const events = bus2.loadFromLog();

    assert.equal(events.length, 2);
    assert.equal(bus2.recent().length, 2);
    assert.equal(bus2.recent()[1].payload.verdict, "approved");
  });

  it("handles malformed JSONL lines gracefully", () => {
    const logPath = join(tmpDir, "malformed.jsonl");
    writeFileSync(logPath, '{"type":"audit.start","timestamp":1,"source":"codex","payload":{}}\nBAD_LINE\n{"type":"retro.complete","timestamp":2,"source":"claude-code","payload":{}}\n');

    const bus = new QuorumBus({ logPath });
    const events = bus.loadFromLog();
    assert.equal(events.length, 2);
  });

  it("works without logPath (no persistence)", () => {
    const bus = new QuorumBus({ logPath: null });
    bus.emit(createEvent("audit.start", "codex"));
    assert.equal(bus.recent().length, 1);
    // No crash
  });
});

// ═══ 4. createEvent factory ═══════════════════════════════════════════

describe("createEvent", () => {
  it("sets timestamp automatically", () => {
    const before = Date.now();
    const event = createEvent("audit.start", "claude-code");
    const after = Date.now();

    assert.ok(event.timestamp >= before && event.timestamp <= after);
  });

  it("includes source and payload", () => {
    const event = createEvent("agent.spawn", "codex", { name: "impl-1", role: "implementer" });
    assert.equal(event.source, "codex");
    assert.equal(event.payload.name, "impl-1");
  });

  it("includes optional meta fields", () => {
    const event = createEvent("track.progress", "claude-code", { total: 10 }, {
      sessionId: "s-123",
      trackId: "TN-1",
      agentId: "impl-a",
    });
    assert.equal(event.sessionId, "s-123");
    assert.equal(event.trackId, "TN-1");
    assert.equal(event.agentId, "impl-a");
  });
});
