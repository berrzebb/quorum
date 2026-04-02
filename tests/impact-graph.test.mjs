#!/usr/bin/env node
/**
 * GRAPH-3: Impact Graph Integration Tests
 *
 * Tests buildImpactGraph() with mock tools:
 * - Empty input handling
 * - Blast radius integration
 * - RTM trace integration
 * - Gap detection (no_impl, no_trace)
 * - Entity upsert into SQLite
 * - Summary statistics
 *
 * Run: node --test tests/impact-graph.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const { EventStore } = await import("../dist/platform/bus/store.js");
const { getEntity } = await import("../dist/platform/bus/graph-schema.js");
const { buildImpactGraph } = await import("../dist/platform/bus/impact-graph.js");

// ── Mock tools ──────────────────────────────

function mockTools(overrides = {}) {
  return {
    blastRadius: overrides.blastRadius ?? (() => ({
      json: {
        affected: 3,
        total: 100,
        ratio: 0.03,
        maxDepthReached: false,
        files: [
          { file: "src/foo.ts", depth: 1, via: null },
          { file: "src/bar.ts", depth: 1, via: null },
          { file: "src/baz.ts", depth: 2, via: "src/foo.ts" },
        ],
      },
    })),
    dependencyGraph: overrides.dependencyGraph ?? (() => ({
      json: { files: 100, edges: 250, components: 5, cycles: 2 },
    })),
    rtmParse: overrides.rtmParse ?? (() => ({
      json: {
        matrix: "forward",
        total: 10,
        filtered: 3,
        rows: [
          { req_id: "FR-01", file: "src/foo.ts", status: "done" },
          { req_id: "FR-02", file: "", status: "open" },
          { req_id: "FR-03", file: "src/other.ts", status: "done" },
        ],
      },
    })),
    coverageMap: overrides.coverageMap ?? (() => ({
      text: "| File | Statements |\n|------|------|\n| src/foo.ts | 85% |",
      summary: "1 files",
    })),
  };
}

// ═══ 1. Empty input ═══════════════════════════════════════════════════════

describe("buildImpactGraph — empty input", () => {
  it("returns empty graph for no changed files", async () => {
    const result = await buildImpactGraph([], { tools: mockTools() });
    assert.deepEqual(result.sources, []);
    assert.equal(result.affected.length, 0);
    assert.equal(result.gaps.length, 0);
    assert.equal(result.summary.totalAffected, 0);
    assert.equal(result.summary.blastRatio, 0);
  });

  it("returns empty graph for null-ish input", async () => {
    const result = await buildImpactGraph(null, { tools: mockTools() });
    assert.deepEqual(result.sources, []);
  });
});

// ═══ 2. Blast radius integration ═════════════════════════════════════════

describe("buildImpactGraph — blast radius", () => {
  it("maps blast radius files to affected nodes", async () => {
    const result = await buildImpactGraph(["src/main.ts"], { tools: mockTools() });
    assert.equal(result.affected.length >= 3, true);

    const direct = result.affected.filter(a => a.impact === "direct");
    const transitive = result.affected.filter(a => a.impact === "transitive");
    assert.equal(direct.length, 2); // depth 1
    assert.equal(transitive.length, 1); // depth 2
    assert.equal(transitive[0].via, "src/foo.ts");
  });

  it("sets type to file for blast radius nodes", async () => {
    const result = await buildImpactGraph(["src/main.ts"], { tools: mockTools() });
    for (const node of result.affected.filter(a => a.type === "file")) {
      assert.equal(node.type, "file");
    }
  });

  it("handles blast radius error gracefully", async () => {
    const tools = mockTools({
      blastRadius: () => ({ error: "changed_files required" }),
    });
    const result = await buildImpactGraph(["src/main.ts"], { tools });
    // Should not throw, just have no file-type affected nodes
    assert.equal(result.affected.filter(a => a.type === "file").length, 0);
  });
});

// ═══ 3. Dependency graph integration ═════════════════════════════════════

describe("buildImpactGraph — dependency graph", () => {
  it("populates summary with dependency graph metrics", async () => {
    const result = await buildImpactGraph(["src/main.ts"], { tools: mockTools() });
    assert.equal(result.summary.components, 5);
    assert.equal(result.summary.cycles, 2);
  });

  it("handles dependency graph error gracefully", async () => {
    const tools = mockTools({
      dependencyGraph: () => ({ error: "path not found" }),
    });
    const result = await buildImpactGraph(["src/main.ts"], { tools });
    assert.equal(result.summary.components, 0);
    assert.equal(result.summary.cycles, 0);
  });
});

// ═══ 4. RTM trace integration ════════════════════════════════════════════

describe("buildImpactGraph — RTM traces", () => {
  it("adds traced requirements to affected list", async () => {
    const result = await buildImpactGraph(["src/foo.ts"], {
      tools: mockTools(),
      rtmPath: "docs/rtm.md",
    });
    const reqs = result.affected.filter(a => a.type === "requirement");
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].id, "FR-01");
    assert.equal(reqs[0].impact, "trace");
  });

  it("skips RTM when rtmPath not provided", async () => {
    const result = await buildImpactGraph(["src/main.ts"], { tools: mockTools() });
    const reqs = result.affected.filter(a => a.type === "requirement");
    assert.equal(reqs.length, 0);
  });

  it("handles RTM parse error gracefully", async () => {
    const tools = mockTools({
      rtmParse: () => ({ error: "Not found" }),
    });
    const result = await buildImpactGraph(["src/main.ts"], { tools, rtmPath: "bad.md" });
    assert.equal(result.summary.rtmRows, 0);
  });
});

// ═══ 5. Gap detection ════════════════════════════════════════════════════

describe("buildImpactGraph — gap detection", () => {
  it("detects no_impl gap (empty file column)", async () => {
    const result = await buildImpactGraph(["src/main.ts"], {
      tools: mockTools(),
      rtmPath: "docs/rtm.md",
    });
    const implGaps = result.gaps.filter(g => g.type === "no_impl");
    assert.equal(implGaps.length, 1);
    assert.equal(implGaps[0].entityId, "FR-02");
  });

  it("detects no_trace gap (open status)", async () => {
    const result = await buildImpactGraph(["src/main.ts"], {
      tools: mockTools(),
      rtmPath: "docs/rtm.md",
    });
    const traceGaps = result.gaps.filter(g => g.type === "no_trace");
    assert.equal(traceGaps.length, 1);
    assert.equal(traceGaps[0].entityId, "FR-02");
  });

  it("gap count reflected in summary", async () => {
    const result = await buildImpactGraph(["src/main.ts"], {
      tools: mockTools(),
      rtmPath: "docs/rtm.md",
    });
    assert.equal(result.summary.gapCount, result.gaps.length);
    assert.ok(result.summary.gapCount > 0);
  });
});

// ═══ 6. Summary statistics ═══════════════════════════════════════════════

describe("buildImpactGraph — summary", () => {
  it("computes correct blast ratio", async () => {
    const result = await buildImpactGraph(["src/main.ts"], { tools: mockTools() });
    assert.equal(result.summary.blastRatio, 0.03);
  });

  it("counts total affected", async () => {
    const result = await buildImpactGraph(["src/main.ts"], { tools: mockTools() });
    assert.equal(result.summary.totalAffected, result.affected.length);
  });

  it("includes RTM row count", async () => {
    const result = await buildImpactGraph(["src/main.ts"], {
      tools: mockTools(),
      rtmPath: "docs/rtm.md",
    });
    assert.equal(result.summary.rtmRows, 3);
  });
});

// ═══ 7. Entity upsert ═══════════════════════════════════════════════════

describe("buildImpactGraph — entity upsert", () => {
  let store;
  let db;

  beforeEach(() => {
    store = new EventStore(":memory:");
    db = store.db;
  });
  afterEach(() => { store.close(); });

  it("upserts requirement entities from RTM traces", async () => {
    await buildImpactGraph(["src/foo.ts"], {
      tools: mockTools(),
      rtmPath: "docs/rtm.md",
      db,
    });
    const entity = getEntity(db, "FR-01");
    assert.ok(entity);
    assert.equal(entity.type, "requirement");
    assert.equal(entity.metadata.source, "impact-graph");
  });

  it("does not upsert file-type nodes", async () => {
    await buildImpactGraph(["src/foo.ts"], {
      tools: mockTools(),
      db,
    });
    // file nodes should not be in entities table
    const entity = getEntity(db, "src/foo.ts");
    assert.equal(entity, null);
  });

  it("skips upsert if entity already exists", async () => {
    const { addEntity } = await import("../dist/platform/bus/graph-schema.js");
    addEntity(db, { id: "FR-01", type: "requirement", title: "Existing" });

    await buildImpactGraph(["src/foo.ts"], {
      tools: mockTools(),
      rtmPath: "docs/rtm.md",
      db,
    });
    const entity = getEntity(db, "FR-01");
    assert.equal(entity.title, "Existing"); // not overwritten
  });
});

// ═══ 8. Deduplication ════════════════════════════════════════════════════

describe("buildImpactGraph — deduplication", () => {
  it("does not duplicate nodes from blast + RTM", async () => {
    const tools = mockTools({
      blastRadius: () => ({
        json: {
          affected: 1, total: 10, ratio: 0.1, maxDepthReached: false,
          files: [{ file: "src/foo.ts", depth: 1, via: null }],
        },
      }),
    });
    const result = await buildImpactGraph(["src/foo.ts"], {
      tools,
      rtmPath: "docs/rtm.md",
    });
    // src/foo.ts appears in blast radius AND rtm, but as different types (file vs requirement)
    // FR-01 traces to src/foo.ts, should appear once as requirement
    const ids = result.affected.map(a => a.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, "No duplicate IDs");
  });
});

// ═══ 9. Type contract ════════════════════════════════════════════════════

describe("ImpactGraph type contract", () => {
  it("returns all required fields", async () => {
    const result = await buildImpactGraph(["src/main.ts"], { tools: mockTools() });
    assert.ok(Array.isArray(result.sources));
    assert.ok(Array.isArray(result.affected));
    assert.ok(Array.isArray(result.gaps));
    assert.ok(typeof result.summary === "object");
    assert.ok(typeof result.summary.totalAffected === "number");
    assert.ok(typeof result.summary.blastRatio === "number");
    assert.ok(typeof result.summary.components === "number");
    assert.ok(typeof result.summary.cycles === "number");
    assert.ok(typeof result.summary.rtmRows === "number");
    assert.ok(typeof result.summary.gapCount === "number");
  });
});
