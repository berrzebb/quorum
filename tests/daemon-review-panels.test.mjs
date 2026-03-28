#!/usr/bin/env node
/**
 * DUX-13: Review Drill-down and Thread Inspector View — structural contracts.
 *
 * Verifies thread-inspector and finding-detail panel exports, type shapes,
 * messageColor helper, and full review panel file inventory.
 *
 * Run: node --test tests/daemon-review-panels.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ═══ 1. ThreadInspector exports ═════════════════════════════════════════

describe("ThreadInspector exports", () => {
  it("ThreadInspector is exported as a function", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    assert.equal(typeof mod.ThreadInspector, "function", "ThreadInspector should be a function");
  });

  it("messageColor is exported as a function", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    assert.equal(typeof mod.messageColor, "function", "messageColor should be a function");
  });
});

// ═══ 2. FindingDetail exports ═══════════════════════════════════════════

describe("FindingDetail exports", () => {
  it("FindingDetail is exported as a function", async () => {
    const mod = await import("../dist/daemon/panels/review/finding-detail.js");
    assert.equal(typeof mod.FindingDetail, "function", "FindingDetail should be a function");
  });
});

// ═══ 3. messageColor returns correct colors ═════════════════════════════

describe("messageColor returns correct colors", () => {
  let messageColor;

  it("loads messageColor", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    messageColor = mod.messageColor;
    assert.equal(typeof messageColor, "function");
  });

  it("finding → red", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    assert.equal(mod.messageColor("finding"), "red");
  });

  it("reply → cyan", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    assert.equal(mod.messageColor("reply"), "cyan");
  });

  it("ack → yellow", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    assert.equal(mod.messageColor("ack"), "yellow");
  });

  it("resolve → green", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    assert.equal(mod.messageColor("resolve"), "green");
  });

  it("unknown → white", async () => {
    const mod = await import("../dist/daemon/panels/review/thread-inspector.js");
    assert.equal(mod.messageColor("other"), "white");
  });
});

// ═══ 4. All review panel files exist (5 total) ═════════════════════════

describe("All review panel files exist", () => {
  const reviewPanels = [
    ["finding-stats-panel.tsx", "FindingStatsPanel"],
    ["open-findings-panel.tsx", "OpenFindingsPanel"],
    ["review-progress-panel.tsx", "ReviewProgressPanel"],
    ["thread-inspector.tsx", "ThreadInspector"],
    ["finding-detail.tsx", "FindingDetail"],
  ];

  for (const [file, label] of reviewPanels) {
    it(`daemon/panels/review/${file} exists (${label})`, () => {
      const fullPath = resolve("daemon", "panels", "review", file);
      assert.ok(existsSync(fullPath), `Missing: ${file}`);
    });
  }

  it("exactly 5 review panel .tsx files", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = resolve("daemon", "panels", "review");
    const tsxFiles = readdirSync(dir).filter(f => f.endsWith(".tsx"));
    assert.equal(tsxFiles.length, 5, `Expected 5 .tsx files, found ${tsxFiles.length}: ${tsxFiles.join(", ")}`);
  });
});

// ═══ 5. Barrel re-exports include new components ═══════════════════════

describe("Barrel re-exports include new components", () => {
  it("review/index re-exports ThreadInspector", async () => {
    const mod = await import("../dist/daemon/panels/review/index.js");
    assert.equal(typeof mod.ThreadInspector, "function");
  });

  it("review/index re-exports FindingDetail", async () => {
    const mod = await import("../dist/daemon/panels/review/index.js");
    assert.equal(typeof mod.FindingDetail, "function");
  });

  it("review/index re-exports messageColor", async () => {
    const mod = await import("../dist/daemon/panels/review/index.js");
    assert.equal(typeof mod.messageColor, "function");
  });

  it("root panels/index re-exports ThreadInspector", async () => {
    const mod = await import("../dist/daemon/panels/index.js");
    assert.equal(typeof mod.ThreadInspector, "function");
  });

  it("root panels/index re-exports FindingDetail", async () => {
    const mod = await import("../dist/daemon/panels/index.js");
    assert.equal(typeof mod.FindingDetail, "function");
  });

  it("root panels/index re-exports messageColor", async () => {
    const mod = await import("../dist/daemon/panels/index.js");
    assert.equal(typeof mod.messageColor, "function");
  });
});

// ═══ 6. Existing DUX-9 panels still work ═══════════════════════════════

describe("Existing DUX-9 panels still work", () => {
  it("FindingStatsPanel still exported", async () => {
    const mod = await import("../dist/daemon/panels/review/finding-stats-panel.js");
    assert.equal(typeof mod.FindingStatsPanel, "function");
  });

  it("OpenFindingsPanel still exported", async () => {
    const mod = await import("../dist/daemon/panels/review/open-findings-panel.js");
    assert.equal(typeof mod.OpenFindingsPanel, "function");
  });

  it("ReviewProgressPanel still exported", async () => {
    const mod = await import("../dist/daemon/panels/review/review-progress-panel.js");
    assert.equal(typeof mod.ReviewProgressPanel, "function");
  });
});
