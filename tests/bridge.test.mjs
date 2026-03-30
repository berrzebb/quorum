#!/usr/bin/env node
/**
 * Bridge Tests — MJS hooks ↔ TypeScript modules integration.
 *
 * Verifies that the bridge correctly connects:
 * - EventStore (emit + query)
 * - Trigger evaluation
 * - Router verdict recording
 * - Stagnation detection
 *
 * Run: node --test tests/bridge.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as bridge from "../platform/core/bridge.mjs";

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "bridge-test-"));
  mkdirSync(join(tmpDir, ".claude"), { recursive: true });
});

after(() => {
  bridge.close();
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { console.warn("bridge cleanup failed:", err?.message ?? err); }
});

// ═══ 1. Initialization ═══════════════════════════════════════════════

describe("bridge init", () => {
  it("initializes successfully when dist/ modules exist", async () => {
    const ready = await bridge.init(tmpDir);
    assert.equal(ready, true);
  });

  it("creates quorum-events.db in .claude/", () => {
    assert.ok(existsSync(join(tmpDir, ".claude", "quorum-events.db")));
  });
});

// ═══ 2. Event emission ═══════════════════════════════════════════════

describe("bridge emitEvent", () => {
  it("emits events to SQLite store", () => {
    const id = bridge.emitEvent("audit.submit", "claude-code", {
      tier: "T2",
    });
    assert.ok(id);
  });

  it("events are queryable", () => {
    const events = bridge.queryEvents({ eventType: "audit.submit" });
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.tier, "T2");
  });
});

// ═══ 3. Trigger evaluation ═══════════════════════════════════════════

describe("bridge evaluateTrigger", () => {
  it("evaluates trigger and returns mode/tier/score", () => {
    const result = bridge.evaluateTrigger({
      changedFiles: 1,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });
    assert.ok(result);
    assert.ok(["skip", "simple", "deliberative"].includes(result.mode));
    assert.ok(["T1", "T2", "T3"].includes(result.tier));
    assert.ok(typeof result.score === "number");
  });
});

// ═══ 4. Router verdict recording ═════════════════════════════════════

describe("bridge recordVerdict", () => {
  it("records success without escalation", () => {
    const result = bridge.recordVerdict("TN-1", true);
    assert.ok(result);
    assert.equal(result.escalated, false);
  });

  it("escalates after consecutive failures", () => {
    bridge.recordVerdict("TN-2", false);
    const result = bridge.recordVerdict("TN-2", false);
    assert.ok(result);
    assert.equal(result.escalated, true);
  });

  it("returns current tier", () => {
    const tier = bridge.currentTier("TN-2");
    assert.equal(tier, "standard");
  });
});

// ═══ 5. Stagnation detection ═════════════════════════════════════════

describe("bridge detectStagnation", () => {
  it("detects no stagnation with few events", () => {
    const result = bridge.detectStagnation(tmpDir);
    assert.ok(result);
    assert.equal(result.detected, false);
  });

  it("detects stagnation after repeated identical verdicts", () => {
    // Emit 3 identical verdict events
    for (let i = 0; i < 3; i++) {
      bridge.emitEvent("audit.verdict", "codex", {
        verdict: "changes_requested",
        codes: ["lint-gap"],
      });
    }

    const result = bridge.detectStagnation(tmpDir);
    assert.ok(result);
    assert.ok(result.detected);
    assert.ok(result.patterns.length > 0);
  });
});

// ═══ 6. Graceful degradation ═════════════════════════════════════════

describe("bridge graceful degradation", () => {
  it("emitEvent returns null when not initialized", () => {
    bridge.close();
    const id = bridge.emitEvent("test.event", "test");
    assert.equal(id, null);
  });

  it("queryEvents returns empty array when not initialized", () => {
    const events = bridge.queryEvents();
    assert.deepEqual(events, []);
  });

  it("evaluateTrigger returns null when not initialized", () => {
    const result = bridge.evaluateTrigger({ changedFiles: 1 });
    assert.equal(result, null);
  });
});
