#!/usr/bin/env node
/**
 * Parliament Gate Tests — structural enforcement gates.
 *
 * Tests: amendment gate, verdict gate, confluence gate, design gate, regression gate.
 *
 * Run: node --test tests/parliament-gate.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const { EventStore } = await import("../dist/platform/bus/store.js");
const {
  checkAmendmentGate,
  checkVerdictGate,
  checkConfluenceGate,
  checkDesignGate,
  checkAllGates,
  detectRegression,
} = await import("../dist/platform/bus/parliament-gate.js");
const { createEvent } = await import("../dist/platform/bus/events.js");

function createStore() {
  return new EventStore({ dbPath: ":memory:" });
}

// ═══ 1. Amendment Gate ═══════════════════════════════════════════

describe("Amendment Gate", () => {
  it("allows when no amendments exist", () => {
    const store = createStore();
    const result = checkAmendmentGate(store);
    assert.equal(result.allowed, true);
  });

  it("blocks when pending amendments exist", () => {
    const store = createStore();
    store.append(createEvent("parliament.amendment.propose", "generic", {
      amendmentId: "A-001", target: "design", change: "add caching",
    }));

    const result = checkAmendmentGate(store);
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("pending"));
  });

  it("allows when all amendments are resolved", () => {
    const store = createStore();
    store.append(createEvent("parliament.amendment.propose", "generic", { amendmentId: "A-001" }));
    store.append(createEvent("parliament.amendment.resolve", "generic", { amendmentId: "A-001" }));

    const result = checkAmendmentGate(store);
    assert.equal(result.allowed, true);
  });
});

// ═══ 2. Verdict Gate ═════════════════════════════════════════════

describe("Verdict Gate", () => {
  it("allows when no verdicts exist", () => {
    const store = createStore();
    const result = checkVerdictGate(store);
    assert.equal(result.allowed, true);
  });

  it("allows when latest verdict is approved", () => {
    const store = createStore();
    store.append(createEvent("audit.verdict", "generic", { verdict: "approved" }));

    const result = checkVerdictGate(store);
    assert.equal(result.allowed, true);
  });

  it("blocks when latest verdict is changes_requested", () => {
    const store = createStore();
    store.append(createEvent("audit.verdict", "generic", { verdict: "changes_requested" }));

    const result = checkVerdictGate(store);
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("changes_requested"));
  });
});

// ═══ 3. Design Gate ══════════════════════════════════════════════

describe("Design Gate", () => {
  const tmpDir = resolve(process.cwd(), ".test-design-gate-" + Date.now());

  it("blocks when design directory does not exist", () => {
    const result = checkDesignGate(tmpDir, "track-a");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("does not exist"));
  });

  it("blocks when design directory is empty", () => {
    const designDir = resolve(tmpDir, "track-b", "design");
    mkdirSync(designDir, { recursive: true });
    try {
      const result = checkDesignGate(tmpDir, "track-b");
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes("empty"));
    } finally {
      rmSync(resolve(tmpDir, "track-b"), { recursive: true, force: true });
    }
  });

  it("allows when design artifacts exist", () => {
    const designDir = resolve(tmpDir, "track-c", "design");
    mkdirSync(designDir, { recursive: true });
    writeFileSync(resolve(designDir, "spec.md"), "# Spec", "utf8");
    try {
      const result = checkDesignGate(tmpDir, "track-c");
      assert.equal(result.allowed, true);
    } finally {
      rmSync(resolve(tmpDir, "track-c"), { recursive: true, force: true });
    }
  });

  // Cleanup
  it("cleanup", () => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { console.warn("parliament-gate cleanup failed:", err?.message ?? err); }
    assert.ok(true);
  });
});

// ═══ 4. Regression Detection ═════════════════════════════════════

describe("Regression Detection", () => {
  it("allows forward progression", () => {
    assert.equal(detectRegression("raw-output", "autofix").allowed, true);
    assert.equal(detectRegression("autofix", "manual-fix").allowed, true);
    assert.equal(detectRegression("manual-fix", "normal-form").allowed, true);
  });

  it("detects backward regression", () => {
    const r1 = detectRegression("manual-fix", "autofix");
    assert.equal(r1.allowed, false);
    assert.ok(r1.reason.includes("regression"));

    const r2 = detectRegression("normal-form", "raw-output");
    assert.equal(r2.allowed, false);
  });

  it("allows same-stage (no change)", () => {
    assert.equal(detectRegression("autofix", "autofix").allowed, true);
  });
});

// ═══ 5. Combined Gate ════════════════════════════════════════════

describe("Combined Gate (checkAllGates)", () => {
  it("allows when all gates pass", () => {
    const store = createStore();
    store.append(createEvent("audit.verdict", "generic", { verdict: "approved" }));

    const result = checkAllGates(store);
    assert.equal(result.allowed, true);
  });

  it("blocks on first failure (amendment)", () => {
    const store = createStore();
    store.append(createEvent("parliament.amendment.propose", "generic", { amendmentId: "A-X" }));

    const result = checkAllGates(store);
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("pending"));
  });

  it("blocks on verdict after amendments pass", () => {
    const store = createStore();
    store.append(createEvent("audit.verdict", "generic", { verdict: "changes_requested" }));

    const result = checkAllGates(store);
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("changes_requested"));
  });
});
