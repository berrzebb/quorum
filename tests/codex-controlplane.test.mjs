#!/usr/bin/env node
/**
 * SDK-12: Control Plane — Capability Registry Tests
 *
 * Tests the tool capability registry:
 * - Tool metadata lookup (read-only, destructive, concurrency-safe)
 * - Tool surface builder (role-based tool selection)
 *
 * Run: node --test tests/codex-controlplane.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  getCapability,
  isDestructive,
  isReadOnly,
  isConcurrencySafe,
  allToolNames,
  isKnownTool,
  buildToolSurface,
  TOOL_CAPABILITIES,
} = await import("../dist/platform/core/tools/capability-registry.js");

// ═══ Capability Registry Bridge ═══════════════════════════════════════

describe("Capability Registry Bridge", () => {
  it("re-exports TOOL_CAPABILITIES with 26 entries", () => {
    assert.equal(TOOL_CAPABILITIES.length, 26);
  });

  it("getCapability returns metadata for known tool", () => {
    const cap = getCapability("code_map");
    assert.ok(cap);
    assert.equal(cap.name, "code_map");
    assert.equal(cap.isReadOnly, true);
    assert.equal(cap.isDestructive, false);
  });

  it("getCapability returns undefined for unknown tool", () => {
    assert.equal(getCapability("nonexistent_tool"), undefined);
  });

  it("isDestructive returns false for read-only tools", () => {
    assert.equal(isDestructive("code_map"), false);
    assert.equal(isDestructive("blast_radius"), false);
  });

  it("isReadOnly returns true for analysis tools", () => {
    assert.equal(isReadOnly("code_map"), true);
    assert.equal(isReadOnly("dependency_graph"), true);
  });

  it("allToolNames returns 26 names", () => {
    const names = allToolNames();
    assert.equal(names.length, 26);
    assert.ok(names.includes("code_map"));
    assert.ok(names.includes("audit_submit"));
  });

  it("isKnownTool distinguishes known/unknown", () => {
    assert.equal(isKnownTool("code_map"), true);
    assert.equal(isKnownTool("write_file"), false);
  });

  it("buildToolSurface returns tools for implementer role", () => {
    const surface = buildToolSurface("implementer");
    assert.ok(surface.tools.length > 0);
    assert.ok(Array.isArray(surface.deferred));
    assert.ok(typeof surface.env === "object");
  });
});
