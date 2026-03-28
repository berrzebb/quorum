#!/usr/bin/env node
/**
 * DUX-15: Density Modes and Status Grammar — runtime tests.
 *
 * Run: node --test tests/daemon-density.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  getDensityConfig,
  STATUS_GRAMMAR,
  getStatusGrammar,
} = await import("../dist/daemon/shell/density.js");

// ═══ 1. getDensityConfig ═════════════════════════════════════════════

describe("getDensityConfig", () => {
  it("comfortable mode returns correct values", () => {
    const cfg = getDensityConfig("comfortable");
    assert.equal(cfg.mode, "comfortable");
    assert.equal(cfg.panelPadding, 1);
    assert.equal(cfg.showBorders, true);
    assert.equal(cfg.maxListItems, 10);
    assert.equal(cfg.showSparklines, true);
  });

  it("compact mode returns correct values", () => {
    const cfg = getDensityConfig("compact");
    assert.equal(cfg.mode, "compact");
    assert.equal(cfg.panelPadding, 0);
    assert.equal(cfg.showBorders, false);
    assert.equal(cfg.maxListItems, 5);
    assert.equal(cfg.showSparklines, false);
  });
});

// ═══ 2. STATUS_GRAMMAR ══════════════════════════════════════════════

describe("STATUS_GRAMMAR", () => {
  it("has entries for all gate states", () => {
    for (const k of ["gate.open", "gate.blocked", "gate.pending", "gate.error"]) {
      assert.ok(STATUS_GRAMMAR[k], `missing ${k}`);
    }
  });

  it("has entries for all agent states", () => {
    for (const k of ["agent.running", "agent.idle", "agent.auditing", "agent.correcting", "agent.done", "agent.error"]) {
      assert.ok(STATUS_GRAMMAR[k], `missing ${k}`);
    }
  });

  it("has entries for all finding severities", () => {
    for (const k of ["finding.critical", "finding.major", "finding.minor"]) {
      assert.ok(STATUS_GRAMMAR[k], `missing ${k}`);
    }
  });

  it("has entries for all verdict outcomes", () => {
    for (const k of ["verdict.approved", "verdict.changes_requested", "verdict.infra_failure"]) {
      assert.ok(STATUS_GRAMMAR[k], `missing ${k}`);
    }
  });

  it("all values have icon, color, label", () => {
    for (const [key, val] of Object.entries(STATUS_GRAMMAR)) {
      assert.equal(typeof val.icon, "string", `${key} icon should be string`);
      assert.equal(typeof val.color, "string", `${key} color should be string`);
      assert.equal(typeof val.label, "string", `${key} label should be string`);
      assert.ok(val.icon.length > 0, `${key} icon should not be empty`);
      assert.ok(val.color.length > 0, `${key} color should not be empty`);
      assert.ok(val.label.length > 0, `${key} label should not be empty`);
    }
  });

  it("count is at least 16", () => {
    assert.ok(Object.keys(STATUS_GRAMMAR).length >= 16, `expected >= 16, got ${Object.keys(STATUS_GRAMMAR).length}`);
  });
});

// ═══ 3. getStatusGrammar ═════════════════════════════════════════════

describe("getStatusGrammar", () => {
  it("returns known status", () => {
    const s = getStatusGrammar("gate.open");
    assert.equal(s.color, "green");
    assert.equal(s.label, "Open");
  });

  it("returns fallback for unknown key", () => {
    const s = getStatusGrammar("unknown.state");
    assert.equal(s.icon, "?");
    assert.equal(s.color, "white");
    assert.equal(s.label, "unknown.state");
  });
});
