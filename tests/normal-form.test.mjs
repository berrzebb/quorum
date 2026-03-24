#!/usr/bin/env node
/**
 * Normal Form Convergence Tests — stage classification + conformance tracking.
 *
 * Tests:
 *   1. classifyStage() — 4 stage transitions
 *   2. computeConformance() — boundary values
 *   3. trackProviderConvergence() — with verdict events
 *   4. generateConvergenceReport() — empty store
 *
 * Run: node --test tests/normal-form.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";

const { classifyStage, computeConformance, trackProviderConvergence, generateConvergenceReport } =
  await import("../dist/bus/normal-form.js");
const { EventStore } = await import("../dist/bus/store.js");
const { createEvent } = await import("../dist/bus/events.js");

// ═══ 1. classifyStage() ══════════════════════════════════════════════════

describe("classifyStage()", () => {
  it("0 rounds → raw-output", () => {
    assert.equal(classifyStage(0, null, false), "raw-output");
  });

  it("1 round, not approved → autofix", () => {
    assert.equal(classifyStage(1, "changes_requested", false), "autofix");
  });

  it("3 rounds, not approved → manual-fix", () => {
    assert.equal(classifyStage(3, "changes_requested", false), "manual-fix");
  });

  it("approved + confluence → normal-form", () => {
    assert.equal(classifyStage(1, "approved", true), "normal-form");
  });
});

// ═══ 2. computeConformance() ═════════════════════════════════════════════

describe("computeConformance()", () => {
  it("all 1.0 → 100%", () => {
    const result = computeConformance(1.0, 1.0, 1.0);
    assert.equal(result, 100);
  });

  it("all 0.0 → 0%", () => {
    const result = computeConformance(0.0, 0.0, 0.0);
    assert.equal(result, 0);
  });
});

// ═══ 3. trackProviderConvergence() ═══════════════════════════════════════

describe("trackProviderConvergence()", () => {
  it("tracks verdict events for a provider", () => {
    const store = new EventStore({ dbPath: ":memory:" });

    // Append verdict events from claude-code
    store.append(createEvent("audit.verdict", "claude-code", {
      itemId: "item-1",
      verdict: "changes_requested",
      codes: ["MISSING_TEST"],
    }));
    store.append(createEvent("audit.verdict", "claude-code", {
      itemId: "item-1",
      verdict: "approved",
      codes: [],
    }));

    const convergence = trackProviderConvergence(store, "claude-code");

    assert.equal(convergence.provider, "claude-code");
    assert.equal(convergence.totalRounds, 2);
    assert.ok(convergence.stages.length >= 1, "should have at least raw-output stage");
    assert.ok(["raw-output", "autofix", "normal-form"].includes(convergence.currentStage));

    store.close();
  });
});

// ═══ 4. generateConvergenceReport() ══════════════════════════════════════

describe("generateConvergenceReport()", () => {
  it("empty store → empty providers", () => {
    const store = new EventStore({ dbPath: ":memory:" });

    const report = generateConvergenceReport(store);

    assert.equal(report.providers.length, 0);
    assert.equal(report.allConverged, false);
    assert.equal(report.avgRoundsToNormalForm, null);
    assert.ok(report.timestamp > 0);

    store.close();
  });
});
