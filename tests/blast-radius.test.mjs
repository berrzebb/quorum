#!/usr/bin/env node
/**
 * Blast Radius Tests.
 *
 * Tests:
 *   1. computeBlastRadiusFromGraph — pure BFS on synthetic graph
 *   2. buildRawGraph — real file system graph construction
 *   3. computeBlastRadius — end-to-end with quorum source tree
 *   4. toolBlastRadius — MCP tool interface
 *   5. trigger: blastRadius factor integration
 *
 * Run: node --test tests/blast-radius.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolve } from "node:path";

const {
  buildRawGraph,
  computeBlastRadiusFromGraph,
  computeBlastRadius,
  toolBlastRadius,
} = await import("../core/tools/tool-core.mjs");

const { evaluateTrigger } = await import("../dist/providers/trigger.js");

// ═══ 1. computeBlastRadiusFromGraph — pure BFS ═══════════════════════════

describe("computeBlastRadiusFromGraph", () => {
  // Import chain: D imports C imports B imports A
  // E also imports A
  // inEdges maps: file → set of files that import it (reverse edges)
  // So if D imports C: inEdges[C] = {D}, meaning "C is imported by D"
  // BFS from A follows inEdges: A → B (imports A) → C (imports B) → D (imports C)
  const inEdges = new Map([
    ["A", new Set(["B", "E"])],   // A is imported by B and E
    ["B", new Set(["C"])],         // B is imported by C
    ["C", new Set(["D"])],         // C is imported by D
    ["D", new Set()],              // D is a leaf (nobody imports it)
    ["E", new Set()],              // E is a leaf
  ]);

  it("returns seed files at depth 0", () => {
    const { affected } = computeBlastRadiusFromGraph(inEdges, ["A"]);
    assert.equal(affected.get("A").depth, 0);
    assert.equal(affected.get("A").via, null);
  });

  it("finds direct dependents at depth 1", () => {
    const { affected } = computeBlastRadiusFromGraph(inEdges, ["A"]);
    assert.equal(affected.get("B").depth, 1);
    assert.equal(affected.get("B").via, "A");
    assert.equal(affected.get("E").depth, 1);
    assert.equal(affected.get("E").via, "A");
  });

  it("finds transitive dependents at depth 2+", () => {
    const { affected } = computeBlastRadiusFromGraph(inEdges, ["A"]);
    assert.equal(affected.get("C").depth, 2);
    assert.equal(affected.get("D").depth, 3);
    assert.equal(affected.size, 5); // A, B, C, D, E
  });

  it("respects maxDepth", () => {
    const { affected, maxDepthReached } = computeBlastRadiusFromGraph(inEdges, ["A"], 2);
    assert.ok(affected.has("B")); // depth 1
    assert.ok(affected.has("C")); // depth 2
    assert.ok(!affected.has("D")); // depth 3 — cut off
    assert.ok(maxDepthReached);
  });

  it("handles multiple seed files", () => {
    const { affected } = computeBlastRadiusFromGraph(inEdges, ["B", "E"]);
    assert.equal(affected.get("B").depth, 0); // seed
    assert.equal(affected.get("E").depth, 0); // seed
    assert.equal(affected.get("C").depth, 1); // C imports B
    assert.equal(affected.get("D").depth, 2); // D imports C
    assert.ok(!affected.has("A")); // A is not a dependent of B or E
  });

  it("handles empty graph", () => {
    const empty = new Map();
    const { affected } = computeBlastRadiusFromGraph(empty, ["X"]);
    assert.equal(affected.size, 1); // only seed
    assert.equal(affected.get("X").depth, 0);
  });

  it("handles cycles without infinite loop", () => {
    const cyclic = new Map([
      ["X", new Set(["Z"])],
      ["Y", new Set(["X"])],
      ["Z", new Set(["Y"])],
    ]);
    const { affected } = computeBlastRadiusFromGraph(cyclic, ["X"]);
    assert.equal(affected.size, 3);
  });
});

// ═══ 2. buildRawGraph — real filesystem ══════════════════════════════════

describe("buildRawGraph", () => {
  it("builds graph for quorum core/ directory", () => {
    const result = buildRawGraph(resolve("core"), 3, null);
    assert.ok(!result.error, `Expected no error, got: ${result.error}`);
    assert.ok(result.files.length > 5, `Expected >5 files, got ${result.files.length}`);
    assert.ok(result.edges instanceof Map);
    assert.ok(result.inEdges instanceof Map);
    assert.ok(result.fileSet instanceof Set);
    assert.equal(result.fileSet.size, result.files.length);
  });

  it("returns error for non-existent path", () => {
    const result = buildRawGraph("/non/existent/path/xyz");
    assert.ok(result.error);
  });

  it("populates both edges and inEdges", () => {
    const result = buildRawGraph(resolve("core"), 3, null);
    // At least some files should have edges
    let hasEdge = false;
    for (const deps of result.edges.values()) {
      if (deps.size > 0) { hasEdge = true; break; }
    }
    assert.ok(hasEdge, "Expected at least one file with outgoing edges");

    let hasInEdge = false;
    for (const deps of result.inEdges.values()) {
      if (deps.size > 0) { hasInEdge = true; break; }
    }
    assert.ok(hasInEdge, "Expected at least one file with incoming edges");
  });
});

// ═══ 3. computeBlastRadius — end-to-end ═════════════════════════════════

describe("computeBlastRadius", () => {
  it("computes blast radius for bridge.mjs", () => {
    const result = computeBlastRadius(resolve("."), [resolve("core/bridge.mjs")]);
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.ok(result.affected > 0, `bridge.mjs should have dependents, got ${result.affected}`);
    assert.ok(result.total > 0);
    assert.ok(result.ratio > 0 && result.ratio <= 1);
    assert.ok(Array.isArray(result.files));
    // Each file entry should have depth, via, file
    for (const f of result.files) {
      assert.ok(f.file, "file should be set");
      assert.ok(typeof f.depth === "number");
    }
  });

  it("returns 0 affected for unknown files", () => {
    const result = computeBlastRadius(resolve("."), [resolve("nonexistent-file-xyz.ts")]);
    assert.equal(result.affected, 0);
    assert.equal(result.ratio, 0);
  });

  it("returns 0 affected for leaf files with no dependents", () => {
    // package.json is not a .ts/.mjs file, so it won't be in the graph
    const result = computeBlastRadius(resolve("."), [resolve("package.json")]);
    assert.equal(result.affected, 0);
  });
});

// ═══ 4. toolBlastRadius — MCP tool interface ═════════════════════════════

describe("toolBlastRadius", () => {
  it("returns error without changed_files", () => {
    assert.ok(toolBlastRadius({}).error);
    assert.ok(toolBlastRadius({ changed_files: [] }).error);
  });

  it("returns markdown output for valid input", () => {
    const result = toolBlastRadius({
      changed_files: ["core/bridge.mjs"],
      path: resolve("."),
    });
    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.ok(result.text.includes("Blast Radius Analysis"));
    assert.ok(result.summary.includes("files affected"));
    assert.ok(result.json);
    assert.ok(typeof result.json.affected === "number");
    assert.ok(typeof result.json.ratio === "number");
  });

  it("caches results for same input", () => {
    const params = { changed_files: ["core/context.mjs"], path: resolve(".") };
    const first = toolBlastRadius(params);
    const second = toolBlastRadius(params);
    assert.ok(!first.cached);
    assert.ok(second.cached);
  });
});

// ═══ 5. trigger: blastRadius factor ══════════════════════════════════════

describe("trigger: blastRadius factor", () => {
  const baseCtx = {
    changedFiles: 3,
    securitySensitive: false,
    priorRejections: 0,
    apiSurfaceChanged: false,
    crossLayerChange: false,
    isRevert: false,
  };

  it("high blast radius increases score", () => {
    const without = evaluateTrigger({ ...baseCtx });
    const withHigh = evaluateTrigger({ ...baseCtx, blastRadius: 0.5 });
    assert.ok(withHigh.score > without.score,
      `Score with blast radius 0.5 (${withHigh.score}) should be > without (${without.score})`);
    assert.ok(withHigh.reasons.some(r => r.includes("blast radius")));
  });

  it("low blast radius (<= 0.1) does not increase score", () => {
    const without = evaluateTrigger({ ...baseCtx });
    const withLow = evaluateTrigger({ ...baseCtx, blastRadius: 0.05 });
    assert.equal(withLow.score, without.score);
  });

  it("blast radius contribution capped at 0.15", () => {
    const withMax = evaluateTrigger({ ...baseCtx, blastRadius: 1.0 });
    const withHigh = evaluateTrigger({ ...baseCtx, blastRadius: 0.8 });
    // Both should have 0.15 contribution (capped)
    const base = evaluateTrigger({ ...baseCtx }).score;
    assert.ok(withMax.score - base <= 0.151); // float tolerance
    assert.ok(withHigh.score - base <= 0.151);
  });

  it("undefined blastRadius has no effect", () => {
    const without = evaluateTrigger({ ...baseCtx });
    const withUndef = evaluateTrigger({ ...baseCtx, blastRadius: undefined });
    assert.equal(withUndef.score, without.score);
  });
});
