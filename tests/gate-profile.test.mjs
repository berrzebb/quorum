/**
 * Tests: Gate Profile Schema (WB-3)
 * GateProfile type + validation + DEFAULT_CONFIG integration.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Dynamic import for TS compiled modules
const { safeParseConfig } = await import("../dist/platform/core/config/schema.js");
const { DEFAULT_CONFIG, GATE_PROFILES } = await import("../dist/platform/core/config/types.js");

describe("gate-profile schema", () => {
  it("DEFAULT_CONFIG has gateProfile balanced", () => {
    assert.equal(DEFAULT_CONFIG.gates.gateProfile, "balanced");
  });

  it("GATE_PROFILES contains all 4 profiles", () => {
    assert.deepEqual([...GATE_PROFILES], ["strict", "balanced", "fast", "prototype"]);
  });

  it("safeParseConfig preserves valid gateProfile", () => {
    const r = safeParseConfig({ gates: { gateProfile: "strict" } });
    assert.equal(r.data.gates.gateProfile, "strict");
    assert.equal(r.success, true);
  });

  it("safeParseConfig defaults gateProfile when missing", () => {
    const r = safeParseConfig({ gates: {} });
    assert.equal(r.data.gates.gateProfile, "balanced");
  });

  it("safeParseConfig rejects invalid gateProfile with error", () => {
    const r = safeParseConfig({ gates: { gateProfile: "turbo" } });
    assert.equal(r.data.gates.gateProfile, "balanced"); // falls back to default
    assert.ok(r.errors.length > 0);
    assert.ok(r.errors.some(e => e.path === "gates.gateProfile"));
  });

  it("safeParseConfig accepts all 4 valid profiles", () => {
    for (const profile of GATE_PROFILES) {
      const r = safeParseConfig({ gates: { gateProfile: profile } });
      assert.equal(r.data.gates.gateProfile, profile);
      assert.equal(r.success, true, `profile "${profile}" should be valid`);
    }
  });

  it("backward compat — config without gateProfile still works", () => {
    const r = safeParseConfig({
      plugin: { locale: "ko" },
      consensus: { trigger_tag: "[REVIEW]" },
    });
    assert.equal(r.data.gates.gateProfile, "balanced");
    assert.equal(r.success, true);
  });
});
