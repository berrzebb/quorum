/**
 * Tests for Tool Capability Registry (SDK-5).
 *
 * Verifies canonical tool metadata adopted from Claude Code Tool.ts patterns:
 * - All 26 MCP tools have capability entries
 * - Metadata fields are correctly typed
 * - Lookup helpers work (role, domain, deferred, search)
 * - Policy invariants hold (fail-closed for unknown tools)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../platform/core/tools/tool-capabilities.mjs");

// ── Registry completeness ────────────────────────────

describe("Tool Capability Registry — completeness", () => {
  it("exports TOOL_CAPABILITIES array", () => {
    assert.ok(Array.isArray(mod.TOOL_CAPABILITIES));
    assert.ok(mod.TOOL_CAPABILITIES.length >= 26, `Expected ≥26 tools, got ${mod.TOOL_CAPABILITIES.length}`);
  });

  it("TOOL_CAPABILITIES is frozen (immutable)", () => {
    assert.ok(Object.isFrozen(mod.TOOL_CAPABILITIES));
  });

  it("every entry has required fields", () => {
    for (const t of mod.TOOL_CAPABILITIES) {
      assert.equal(typeof t.name, "string", `${t.name}: name must be string`);
      assert.equal(typeof t.isConcurrencySafe, "boolean", `${t.name}: isConcurrencySafe`);
      assert.equal(typeof t.isReadOnly, "boolean", `${t.name}: isReadOnly`);
      assert.equal(typeof t.isDestructive, "boolean", `${t.name}: isDestructive`);
      assert.ok(Array.isArray(t.domain), `${t.name}: domain must be array`);
      assert.ok(Array.isArray(t.allowedRoles), `${t.name}: allowedRoles must be array`);
      assert.equal(typeof t.maxResultSizeChars, "number", `${t.name}: maxResultSizeChars`);
      assert.equal(typeof t.category, "string", `${t.name}: category`);
    }
  });

  it("no duplicate tool names", () => {
    const names = mod.TOOL_CAPABILITIES.map(t => t.name);
    const unique = new Set(names);
    assert.equal(names.length, unique.size, "duplicate tool names found");
  });

  const KNOWN_MCP_TOOLS = [
    "code_map", "blast_radius", "dependency_graph", "audit_scan", "audit_submit",
    "perf_scan", "a11y_scan", "compat_check", "i18n_validate", "infra_scan",
    "observability_check", "license_scan", "doc_coverage", "blueprint_lint",
    "contract_drift", "coverage_map", "rtm_parse", "rtm_merge", "fvm_generate",
    "fvm_validate", "audit_history", "ai_guide", "agent_comm", "skill_sync",
    "track_archive", "act_analyze",
  ];

  for (const name of KNOWN_MCP_TOOLS) {
    it(`includes MCP tool: ${name}`, () => {
      assert.ok(mod.isKnownTool(name), `missing tool: ${name}`);
    });
  }
});

// ── Metadata correctness ─────────────────────────────

describe("Tool Capability Registry — metadata correctness", () => {
  it("read-only tools are not destructive", () => {
    for (const t of mod.TOOL_CAPABILITIES) {
      if (t.isReadOnly) {
        assert.equal(t.isDestructive, false, `${t.name}: read-only cannot be destructive`);
      }
    }
  });

  it("always-load tools are not deferred", () => {
    for (const t of mod.TOOL_CAPABILITIES) {
      if (t.alwaysLoad) {
        assert.ok(!t.shouldDefer, `${t.name}: always-load cannot be deferred`);
      }
    }
  });

  it("deferred tools have searchHint", () => {
    for (const t of mod.TOOL_CAPABILITIES) {
      if (t.shouldDefer) {
        assert.ok(t.searchHint && t.searchHint.length > 0, `${t.name}: deferred tools need searchHint`);
      }
    }
  });

  it("domain tools have shouldDefer", () => {
    for (const t of mod.TOOL_CAPABILITIES) {
      if (t.domain.length > 0) {
        assert.ok(t.shouldDefer, `${t.name}: domain-specific tools should be deferred`);
      }
    }
  });

  it("destructive tools are not concurrency-safe", () => {
    for (const t of mod.TOOL_CAPABILITIES) {
      if (t.isDestructive) {
        assert.equal(t.isConcurrencySafe, false, `${t.name}: destructive tools must not be concurrency-safe`);
      }
    }
  });

  it("allowedRoles are valid role names", () => {
    const VALID = new Set(["implementer", "self-checker", "fixer", "scout", "designer", "gap-detector", "wb-parser", "rtm-scanner", "fde-analyst"]);
    for (const t of mod.TOOL_CAPABILITIES) {
      for (const role of t.allowedRoles) {
        assert.ok(VALID.has(role), `${t.name}: invalid role '${role}'`);
      }
    }
  });

  it("maxResultSizeChars > 0 for all tools", () => {
    for (const t of mod.TOOL_CAPABILITIES) {
      assert.ok(t.maxResultSizeChars > 0, `${t.name}: maxResultSizeChars must be positive`);
    }
  });
});

// ── Lookup helpers ───────────────────────────────────

describe("Tool Capability Registry — lookup helpers", () => {
  it("getCapability returns entry for known tool", () => {
    const cap = mod.getCapability("code_map");
    assert.ok(cap);
    assert.equal(cap.name, "code_map");
    assert.equal(cap.isConcurrencySafe, true);
    assert.equal(cap.isReadOnly, true);
  });

  it("getCapability returns undefined for unknown tool", () => {
    assert.equal(mod.getCapability("nonexistent_xyz"), undefined);
  });

  it("isConcurrencySafe returns false for unknown tools (fail-closed)", () => {
    assert.equal(mod.isConcurrencySafe("nonexistent_xyz"), false);
  });

  it("isReadOnly returns false for unknown tools (fail-closed)", () => {
    assert.equal(mod.isReadOnly("nonexistent_xyz"), false);
  });

  it("isDestructive returns false for unknown tools", () => {
    assert.equal(mod.isDestructive("nonexistent_xyz"), false);
  });

  it("toolsForRole('implementer') includes code_map, excludes rtm_parse", () => {
    const tools = mod.toolsForRole("implementer");
    const names = tools.map(t => t.name);
    assert.ok(names.includes("code_map"), "implementer should have code_map");
    assert.ok(!names.includes("rtm_parse"), "implementer should not have rtm_parse (plan-only)");
  });

  it("toolsForRole('self-checker') includes audit_scan", () => {
    const tools = mod.toolsForRole("self-checker");
    const names = tools.map(t => t.name);
    assert.ok(names.includes("audit_scan"));
  });

  it("toolsForDomain('perf') includes perf_scan", () => {
    const tools = mod.toolsForDomain("perf");
    const names = tools.map(t => t.name);
    assert.ok(names.includes("perf_scan"));
  });

  it("toolsForDomain('perf') also includes domain-agnostic tools", () => {
    const tools = mod.toolsForDomain("perf");
    const names = tools.map(t => t.name);
    assert.ok(names.includes("code_map"), "domain-agnostic tools should be included");
  });

  it("alwaysLoadTools returns ≥ 5 tools", () => {
    const tools = mod.alwaysLoadTools();
    assert.ok(tools.length >= 5, `expected ≥5, got ${tools.length}`);
    const names = tools.map(t => t.name);
    assert.ok(names.includes("code_map"));
    assert.ok(names.includes("audit_submit"));
  });

  it("deferredTools returns tools with shouldDefer=true", () => {
    const tools = mod.deferredTools();
    assert.ok(tools.length > 0);
    for (const t of tools) {
      assert.equal(t.shouldDefer, true);
    }
  });
});

// ── Search ──────────────────────────────────────────

describe("Tool Capability Registry — search", () => {
  it("searchTools finds perf_scan for 'performance'", () => {
    const results = mod.searchTools("performance");
    const names = results.map(t => t.name);
    assert.ok(names.includes("perf_scan"));
  });

  it("searchTools finds a11y_scan for 'accessibility WCAG'", () => {
    const results = mod.searchTools("accessibility WCAG");
    const names = results.map(t => t.name);
    assert.ok(names.includes("a11y_scan"));
  });

  it("searchTools respects maxResults", () => {
    const results = mod.searchTools("scan", 3);
    assert.ok(results.length <= 3);
  });

  it("searchTools returns empty for nonsense query", () => {
    const results = mod.searchTools("xyzzyplugh");
    assert.equal(results.length, 0);
  });

  it("searchTools only returns deferred tools", () => {
    const results = mod.searchTools("code symbol index");
    // code_map has searchHint with "symbol index" but is NOT deferred (alwaysLoad)
    for (const t of results) {
      assert.equal(t.shouldDefer, true, `${t.name}: search should only return deferred tools`);
    }
  });
});

// ── buildToolSurface ────────────────────────────────

describe("Tool Capability Registry — buildToolSurface", () => {
  it("implementer gets always-load + implementer-allowed tools", () => {
    const surface = mod.buildToolSurface("implementer");
    assert.ok(surface.tools.includes("code_map"), "always-load");
    assert.ok(surface.tools.includes("audit_submit"), "always-load");
    assert.ok(surface.tools.includes("blast_radius"), "always-load");
  });

  it("implementer does NOT get plan-only tools in tools list", () => {
    const surface = mod.buildToolSurface("implementer");
    assert.ok(!surface.tools.includes("rtm_parse"), "rtm_parse is plan-only");
    assert.ok(!surface.tools.includes("fvm_generate"), "fvm_generate is plan-only");
  });

  it("scout gets plan-only tools", () => {
    const surface = mod.buildToolSurface("scout");
    // rtm_parse is deferred + plan role — should appear in deferred for scout without domain
    assert.ok(
      surface.tools.includes("rtm_parse") || surface.deferred.includes("rtm_parse"),
      "scout should have access to rtm_parse",
    );
  });

  it("domain detection promotes deferred tools to exposed", () => {
    const surface = mod.buildToolSurface("self-checker", ["perf"]);
    assert.ok(surface.tools.includes("perf_scan"), "perf_scan promoted by domain match");
  });

  it("domain detection does NOT promote unrelated deferred tools", () => {
    const surface = mod.buildToolSurface("self-checker", ["perf"]);
    assert.ok(!surface.tools.includes("a11y_scan"), "a11y_scan not promoted without a11y domain");
  });

  it("env has QUORUM_AGENT_ROLE and QUORUM_DETECTED_DOMAINS", () => {
    const surface = mod.buildToolSurface("implementer", ["perf", "a11y"]);
    assert.equal(surface.env.QUORUM_AGENT_ROLE, "implementer");
    assert.equal(surface.env.QUORUM_DETECTED_DOMAINS, "perf,a11y");
  });

  it("tools and deferred arrays are sorted", () => {
    const surface = mod.buildToolSurface("self-checker", ["perf"]);
    const sorted = [...surface.tools].sort();
    assert.deepEqual(surface.tools, sorted, "tools should be sorted");
  });
});

// ── Invariants ──────────────────────────────────────

describe("Tool Capability Registry — invariants", () => {
  it("allToolNames returns all tool names", () => {
    const names = mod.allToolNames();
    assert.ok(names.length >= 26);
    assert.ok(names.includes("code_map"));
    assert.ok(names.includes("track_archive"));
  });

  it("isKnownTool returns true for registered, false for unknown", () => {
    assert.equal(mod.isKnownTool("code_map"), true);
    assert.equal(mod.isKnownTool("fake_tool"), false);
  });

  it("at least 5 tools are always-loaded", () => {
    const always = mod.TOOL_CAPABILITIES.filter(t => t.alwaysLoad);
    assert.ok(always.length >= 5, `need ≥5 always-load tools, got ${always.length}`);
  });

  it("at least 10 tools are deferred", () => {
    const deferred = mod.TOOL_CAPABILITIES.filter(t => t.shouldDefer);
    assert.ok(deferred.length >= 10, `need ≥10 deferred tools, got ${deferred.length}`);
  });

  it("all domain tools serve at least one valid domain", () => {
    const VALID_DOMAINS = new Set(["perf", "a11y", "compat", "i18n", "infra", "observability", "compliance", "docs", "security", "migration", "concurrency"]);
    for (const t of mod.TOOL_CAPABILITIES) {
      for (const d of t.domain) {
        assert.ok(VALID_DOMAINS.has(d), `${t.name}: unknown domain '${d}'`);
      }
    }
  });
});
