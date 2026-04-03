#!/usr/bin/env node
/**
 * Decision Reason Tracking Tests — ERROR-6
 *
 * Run: node --test tests/decision-reason.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createReason,
  withReason,
  withReasonSync,
  logDecision,
  logDecisions,
} from "../dist/platform/core/decision-reason.js";

// ═══ 1. createReason ════════════════════════════════════

describe("createReason", () => {
  it("creates a reason with all fields", () => {
    const r = createReason("error", "timeout occurred", { tool: "Bash" });
    assert.equal(r.type, "error");
    assert.equal(r.reason, "timeout occurred");
    assert.equal(r.context.tool, "Bash");
    assert.ok(r.timestamp > 0);
  });

  it("works without context", () => {
    const r = createReason("retry", "retrying");
    assert.equal(r.type, "retry");
    assert.equal(r.context, undefined);
  });
});

// ═══ 2. withReason (async) ══════════════════════════════

describe("withReason", () => {
  it("collects reasons from async operation", async () => {
    const { result, reasons } = await withReason(async (record) => {
      record(createReason("error", "first attempt failed"));
      record(createReason("retry", "retrying with backoff"));
      return 42;
    });
    assert.equal(result, 42);
    assert.equal(reasons.length, 2);
    assert.equal(reasons[0].type, "error");
    assert.equal(reasons[1].type, "retry");
  });

  it("returns empty reasons on success without records", async () => {
    const { result, reasons } = await withReason(async () => "ok");
    assert.equal(result, "ok");
    assert.equal(reasons.length, 0);
  });
});

// ═══ 3. withReasonSync ══════════════════════════════════

describe("withReasonSync", () => {
  it("collects reasons from sync operation", () => {
    const { result, reasons } = withReasonSync((record) => {
      record(createReason("permission", "denied by rule"));
      return "blocked";
    });
    assert.equal(result, "blocked");
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0].type, "permission");
  });
});

// ═══ 4. logDecision ═════════════════════════════════════

describe("logDecision", () => {
  it("emits event to store", () => {
    const events = [];
    const store = {
      emit(type, payload) { events.push({ type, payload }); },
    };

    logDecision(store, createReason("error", "test error"));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "decision.reason");
    assert.equal(events[0].payload.type, "error");
  });

  it("fail-open on store error", () => {
    const store = {
      emit() { throw new Error("store crashed"); },
    };
    assert.doesNotThrow(() => logDecision(store, createReason("error", "test")));
  });
});

describe("logDecisions", () => {
  it("logs multiple reasons", () => {
    const events = [];
    const store = { emit(type, payload) { events.push({ type, payload }); } };

    logDecisions(store, [
      createReason("error", "a"),
      createReason("retry", "b"),
    ]);
    assert.equal(events.length, 2);
  });
});

// ═══ 5. All DecisionTypes ═══════════════════════════════

describe("all DecisionTypes", () => {
  const types = ["error", "retry", "skip", "fallback", "timeout", "permission", "recovery"];

  for (const type of types) {
    it(`creates ${type} reason`, () => {
      const r = createReason(type, `${type} reason`);
      assert.equal(r.type, type);
    });
  }
});
