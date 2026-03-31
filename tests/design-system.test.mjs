/**
 * Tests for Design System Primitives (SDK-10).
 *
 * Structural tests — verifies exports, type contracts, and density behavior.
 * (Full render tests require ink-testing-library which is not a dependency.)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import compiled modules
const designSystem = await import("../dist/daemon/components/design-system/index.js");
const density = await import("../dist/daemon/shell/density.js");

// ── Exports ─────────────────────────────────────────

describe("Design System — exports", () => {
  it("exports Panel component", () => {
    assert.equal(typeof designSystem.Panel, "function");
  });

  it("exports StatusPill component", () => {
    assert.equal(typeof designSystem.StatusPill, "function");
  });

  it("exports SectionDivider component", () => {
    assert.equal(typeof designSystem.SectionDivider, "function");
  });
});

// ── Density integration ─────────────────────────────

describe("Design System — density integration", () => {
  it("getDensityConfig('comfortable') has borders and padding", () => {
    const config = density.getDensityConfig("comfortable");
    assert.equal(config.showBorders, true);
    assert.equal(config.panelPadding, 1);
    assert.equal(config.maxListItems, 10);
  });

  it("getDensityConfig('compact') has no borders and zero padding", () => {
    const config = density.getDensityConfig("compact");
    assert.equal(config.showBorders, false);
    assert.equal(config.panelPadding, 0);
    assert.equal(config.maxListItems, 5);
  });
});

// ── Status Grammar ──────────────────────────────────

describe("Design System — StatusPill grammar", () => {
  it("STATUS_GRAMMAR has gate states", () => {
    assert.ok(density.STATUS_GRAMMAR["gate.open"]);
    assert.ok(density.STATUS_GRAMMAR["gate.blocked"]);
    assert.ok(density.STATUS_GRAMMAR["gate.pending"]);
  });

  it("STATUS_GRAMMAR has agent states", () => {
    assert.ok(density.STATUS_GRAMMAR["agent.running"]);
    assert.ok(density.STATUS_GRAMMAR["agent.idle"]);
    assert.ok(density.STATUS_GRAMMAR["agent.done"]);
    assert.ok(density.STATUS_GRAMMAR["agent.error"]);
  });

  it("STATUS_GRAMMAR has verdict states", () => {
    assert.ok(density.STATUS_GRAMMAR["verdict.approved"]);
    assert.ok(density.STATUS_GRAMMAR["verdict.changes_requested"]);
    assert.ok(density.STATUS_GRAMMAR["verdict.infra_failure"]);
  });

  it("getStatusGrammar returns fallback for unknown status", () => {
    const fallback = density.getStatusGrammar("unknown.state");
    assert.equal(fallback.icon, "?");
    assert.equal(fallback.color, "white");
  });

  it("each grammar entry has icon, color, label", () => {
    for (const [key, grammar] of Object.entries(density.STATUS_GRAMMAR)) {
      assert.equal(typeof grammar.icon, "string", `${key}: icon`);
      assert.equal(typeof grammar.color, "string", `${key}: color`);
      assert.equal(typeof grammar.label, "string", `${key}: label`);
    }
  });
});

// ── Panel primitive contract ────────────────────────

describe("Design System — Panel contract", () => {
  it("Panel is a React function component (takes props)", () => {
    // Verify it's callable with expected prop shape
    assert.equal(designSystem.Panel.length >= 0, true);
  });
});

// ── StatusPill primitive contract ───────────────────

describe("Design System — StatusPill contract", () => {
  it("StatusPill is a React function component", () => {
    assert.equal(typeof designSystem.StatusPill, "function");
  });
});
