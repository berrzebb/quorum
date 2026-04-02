#!/usr/bin/env node
/**
 * GATE-2: Gate Config Tests
 *
 * Tests GateConfig class and factory functions:
 * - Default config: essential gates only
 * - Full gates: all 21 enabled
 * - cross-model-audit invariant (cannot be disabled)
 * - Custom classification
 * - Barrel exports
 *
 * Run: node --test tests/gate-config.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  GateConfig,
  createDefaultGateConfig,
  createFullGateConfig,
  createGateConfigFromClassification,
  loadGateConfigFromJson,
  DEFAULT_CLASSIFICATION,
} = await import("../dist/platform/orchestrate/governance/gate-config.js");

// ═══ 1. Default config ══════════════════════════════════════════════════

describe("GateConfig — default (essential only)", () => {
  it("enables essential gates", () => {
    const gc = createDefaultGateConfig();
    assert.equal(gc.isEnabled("changed-files"), true);
    assert.equal(gc.isEnabled("stub-scan"), true);
    assert.equal(gc.isEnabled("scope-check"), true);
    assert.equal(gc.isEnabled("cross-model-audit"), true);
    assert.equal(gc.isEnabled("build-verify"), true);
    assert.equal(gc.isEnabled("test-pass"), true);
    assert.equal(gc.isEnabled("runtime-eval"), true);
  });

  it("disables optional gates", () => {
    const gc = createDefaultGateConfig();
    assert.equal(gc.isEnabled("regression"), false);
    assert.equal(gc.isEnabled("perf-scan"), false);
    assert.equal(gc.isEnabled("blueprint-lint"), false);
    assert.equal(gc.isEnabled("fitness"), false);
    assert.equal(gc.isEnabled("test-file-check"), false);
    assert.equal(gc.isEnabled("wb-constraints"), false);
    assert.equal(gc.isEnabled("confluence"), false);
  });

  it("disables disabled-tier gates", () => {
    const gc = createDefaultGateConfig();
    assert.equal(gc.isEnabled("contract-promotion"), false);
    assert.equal(gc.isEnabled("wave-commit"), false);
    assert.equal(gc.isEnabled("orphan-detect"), false);
    assert.equal(gc.isEnabled("license-audit"), false);
    assert.equal(gc.isEnabled("fix-stagnation"), false);
  });

  it("has 7 essential gates enabled", () => {
    const gc = createDefaultGateConfig();
    assert.equal(gc.enabledCount, 7);
  });
});

// ═══ 2. Full gates config ═══════════════════════════════════════════════

describe("GateConfig — full gates", () => {
  it("enables all gates", () => {
    const gc = createFullGateConfig();
    assert.equal(gc.isEnabled("changed-files"), true);
    assert.equal(gc.isEnabled("regression"), true);
    assert.equal(gc.isEnabled("perf-scan"), true);
    assert.equal(gc.isEnabled("blueprint-lint"), true);
    assert.equal(gc.isEnabled("fitness"), true);
    assert.equal(gc.isEnabled("contract-promotion"), true);
    assert.equal(gc.isEnabled("wave-commit"), true);
  });

  it("has 21 gates enabled", () => {
    const gc = createFullGateConfig();
    assert.equal(gc.enabledCount, 21);
  });
});

// ═══ 3. Invariant: cross-model-audit ════════════════════════════════════

describe("GateConfig — invariant", () => {
  it("cross-model-audit is always enabled even in default", () => {
    const gc = createDefaultGateConfig();
    assert.equal(gc.isEnabled("cross-model-audit"), true);
  });

  it("cross-model-audit cannot be removed from essential", () => {
    const badClassification = {
      essential: ["stub-scan"],
      optional: [],
      disabled: ["cross-model-audit"],
    };
    const gc = createGateConfigFromClassification(badClassification);
    assert.equal(gc.isEnabled("cross-model-audit"), true);
  });

  it("cross-model-audit stays enabled when moved to optional", () => {
    const badClassification = {
      essential: ["stub-scan"],
      optional: ["cross-model-audit"],
      disabled: [],
    };
    const gc = createGateConfigFromClassification(badClassification);
    assert.equal(gc.isEnabled("cross-model-audit"), true);
  });
});

// ═══ 4. Custom classification ═══════════════════════════════════════════

describe("GateConfig — custom classification", () => {
  it("respects custom essential list", () => {
    const custom = {
      essential: ["cross-model-audit", "fitness"],
      optional: ["stub-scan"],
      disabled: ["perf-scan"],
    };
    const gc = createGateConfigFromClassification(custom);
    assert.equal(gc.isEnabled("cross-model-audit"), true);
    assert.equal(gc.isEnabled("fitness"), true);
    assert.equal(gc.isEnabled("stub-scan"), false);
    assert.equal(gc.isEnabled("perf-scan"), false);
  });

  it("full-gates enables all in custom classification", () => {
    const custom = {
      essential: ["cross-model-audit"],
      optional: ["stub-scan"],
      disabled: ["perf-scan"],
    };
    const gc = createGateConfigFromClassification(custom, true);
    assert.equal(gc.isEnabled("cross-model-audit"), true);
    assert.equal(gc.isEnabled("stub-scan"), true);
    assert.equal(gc.isEnabled("perf-scan"), true);
  });
});

// ═══ 5. DEFAULT_CLASSIFICATION ══════════════════════════════════════════

describe("DEFAULT_CLASSIFICATION", () => {
  it("has 7 essential gates", () => {
    assert.equal(DEFAULT_CLASSIFICATION.essential.length, 7);
  });

  it("has 9 optional gates", () => {
    assert.equal(DEFAULT_CLASSIFICATION.optional.length, 9);
  });

  it("has 5 disabled gates", () => {
    assert.equal(DEFAULT_CLASSIFICATION.disabled.length, 5);
  });

  it("total is 21", () => {
    const total = DEFAULT_CLASSIFICATION.essential.length
      + DEFAULT_CLASSIFICATION.optional.length
      + DEFAULT_CLASSIFICATION.disabled.length;
    assert.equal(total, 21);
  });

  it("includes cross-model-audit in essential", () => {
    assert.ok(DEFAULT_CLASSIFICATION.essential.includes("cross-model-audit"));
  });
});

// ═══ 6. Barrel exports ══════════════════════════════════════════════════

describe("governance barrel — gate-config exports", () => {
  it("exports from governance index", async () => {
    const gov = await import("../dist/platform/orchestrate/governance/index.js");
    assert.ok(gov.GateConfig);
    assert.ok(gov.createDefaultGateConfig);
    assert.ok(gov.createFullGateConfig);
    assert.ok(gov.DEFAULT_CLASSIFICATION);
  });
});

// ═══ 7. enabledGates list ═══════════════════════════════════════════════

describe("GateConfig — enabledGates", () => {
  it("returns array of enabled gate names", () => {
    const gc = createDefaultGateConfig();
    const gates = gc.enabledGates;
    assert.ok(Array.isArray(gates));
    assert.equal(gates.length, 7);
    assert.ok(gates.includes("cross-model-audit"));
    assert.ok(gates.includes("scope-check"));
  });
});

// ═══ 8. loadGateConfigFromJson (GATE-3) ════════════════════════════════

describe("loadGateConfigFromJson — config.json gates section", () => {
  it("returns default config when gates section is undefined", () => {
    const { config, warnings } = loadGateConfigFromJson(undefined);
    assert.equal(config.enabledCount, 7);
    assert.equal(warnings.length, 0);
  });

  it("uses custom essential list from config", () => {
    const { config } = loadGateConfigFromJson({
      essential: ["cross-model-audit", "fitness", "perf-scan"],
    });
    assert.equal(config.isEnabled("fitness"), true);
    assert.equal(config.isEnabled("perf-scan"), true);
  });

  it("warns when cross-model-audit is in disabled", () => {
    const { config, warnings } = loadGateConfigFromJson({
      essential: ["stub-scan"],
      disabled: ["cross-model-audit"],
    });
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("cross-model-audit"));
    // Still enabled despite being in disabled
    assert.equal(config.isEnabled("cross-model-audit"), true);
  });

  it("supports full-gates with config override", () => {
    const { config } = loadGateConfigFromJson({
      essential: ["cross-model-audit"],
      optional: ["fitness"],
      disabled: ["perf-scan"],
    }, true);
    assert.equal(config.isEnabled("fitness"), true);
    assert.equal(config.isEnabled("perf-scan"), true);
  });

  it("partial config merges with defaults for missing tiers", () => {
    const { config } = loadGateConfigFromJson({
      essential: ["cross-model-audit", "stub-scan", "scope-check"],
      // optional and disabled fall back to defaults
    });
    assert.equal(config.isEnabled("cross-model-audit"), true);
    assert.equal(config.isEnabled("stub-scan"), true);
  });
});
