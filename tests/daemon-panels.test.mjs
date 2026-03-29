#!/usr/bin/env node
/**
 * DUX-9: Daemon Panel Modules — structural contracts for extracted panels.
 *
 * Verifies panel file existence, directory structure, exports, and
 * compiled import integrity. Does NOT render React/Ink components.
 *
 * Run: node --test tests/daemon-panels.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// ═══ 1. Panel directory structure ═════════════════════════════════════

describe("Panel directory structure", () => {
  it("daemon/panels/ directory exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels")));
  });

  it("daemon/panels/shared/ directory exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels", "shared")));
  });

  it("daemon/panels/overview/ directory exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels", "overview")));
  });

  it("daemon/panels/review/ directory exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels", "review")));
  });
});

// ═══ 2. Panel file existence ══════════════════════════════════════════

describe("Panel file existence", () => {
  const expectedFiles = [
    // shared
    ["panels/shared/panel-frame.tsx", "PanelFrame wrapper"],
    // overview
    ["panels/overview/summary-strip.tsx", "SummaryStrip one-liner"],
    ["panels/overview/item-state-panel.tsx", "ItemStatePanel"],
    ["panels/overview/lock-panel.tsx", "LockPanel"],
    ["panels/overview/specialist-panel.tsx", "SpecialistPanel"],
    ["panels/overview/audit-stream-panel.tsx", "AuditStream re-export"],
    // review
    ["panels/review/finding-stats-panel.tsx", "FindingStatsPanel"],
    ["panels/review/open-findings-panel.tsx", "OpenFindingsPanel"],
    ["panels/review/review-progress-panel.tsx", "ReviewProgressPanel"],
    // header
    ["panels/header.tsx", "Header re-export"],
  ];

  for (const [relPath, label] of expectedFiles) {
    it(`daemon/${relPath} exists (${label})`, () => {
      const fullPath = resolve("daemon", relPath);
      assert.ok(existsSync(fullPath), `Missing panel file: ${relPath}`);
    });
  }

  it("at least 8 panel files exist under daemon/panels/", () => {
    let count = 0;
    function countTsx(dir) {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          countTsx(resolve(dir, entry.name));
        } else if (entry.name.endsWith(".tsx")) {
          count++;
        }
      }
    }
    countTsx(resolve("daemon", "panels"));
    assert.ok(count >= 8, `Expected at least 8 .tsx panel files, found ${count}`);
  });
});

// ═══ 3. Barrel exports (index.ts files) ═══════════════════════════════

describe("Barrel exports", () => {
  it("daemon/panels/index.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels", "index.ts")));
  });

  it("daemon/panels/shared/index.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels", "shared", "index.ts")));
  });

  it("daemon/panels/overview/index.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels", "overview", "index.ts")));
  });

  it("daemon/panels/review/index.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "panels", "review", "index.ts")));
  });
});

// ═══ 4. Compiled import checks ════════════════════════════════════════

describe("Compiled panel exports", () => {
  it("PanelFrame is exported from shared/panel-frame", async () => {
    const mod = await import("../dist/daemon/panels/shared/panel-frame.js");
    assert.equal(typeof mod.PanelFrame, "function", "PanelFrame should be a function");
  });

  it("FindingStatsPanel is exported from review/finding-stats-panel", async () => {
    const mod = await import("../dist/daemon/panels/review/finding-stats-panel.js");
    assert.equal(typeof mod.FindingStatsPanel, "function", "FindingStatsPanel should be a function");
  });

  it("OpenFindingsPanel is exported from review/open-findings-panel", async () => {
    const mod = await import("../dist/daemon/panels/review/open-findings-panel.js");
    assert.equal(typeof mod.OpenFindingsPanel, "function", "OpenFindingsPanel should be a function");
  });

  it("ReviewProgressPanel is exported from review/review-progress-panel", async () => {
    const mod = await import("../dist/daemon/panels/review/review-progress-panel.js");
    assert.equal(typeof mod.ReviewProgressPanel, "function", "ReviewProgressPanel should be a function");
  });

  it("ItemStatePanel is exported from overview/item-state-panel", async () => {
    const mod = await import("../dist/daemon/panels/overview/item-state-panel.js");
    assert.equal(typeof mod.ItemStatePanel, "function", "ItemStatePanel should be a function");
  });

  it("LockPanel is exported from overview/lock-panel", async () => {
    const mod = await import("../dist/daemon/panels/overview/lock-panel.js");
    assert.equal(typeof mod.LockPanel, "function", "LockPanel should be a function");
  });

  it("SpecialistPanel is exported from overview/specialist-panel", async () => {
    const mod = await import("../dist/daemon/panels/overview/specialist-panel.js");
    assert.equal(typeof mod.SpecialistPanel, "function", "SpecialistPanel should be a function");
  });

  it("SummaryStrip is exported from overview/summary-strip", async () => {
    const mod = await import("../dist/daemon/panels/overview/summary-strip.js");
    assert.equal(typeof mod.SummaryStrip, "function", "SummaryStrip should be a function");
  });
});

// ═══ 5. Root barrel re-exports all panels ═════════════════════════════

describe("Root barrel re-exports", () => {
  it("panels/index.ts re-exports all key components", async () => {
    const mod = await import("../dist/daemon/panels/index.js");
    const expected = [
      "PanelFrame",
      "SummaryStrip",
      "ItemStatePanel",
      "LockPanel",
      "SpecialistPanel",
      "AuditStream",
      "FindingStatsPanel",
      "OpenFindingsPanel",
      "ReviewProgressPanel",
      "Header",
    ];
    for (const name of expected) {
      assert.ok(name in mod, `Root barrel missing export: ${name}`);
      assert.equal(typeof mod[name], "function", `${name} should be a function`);
    }
  });
});

// ═══ 6. Existing components untouched ═════════════════════════════════

describe("Existing components untouched", () => {
  const existingComponents = [
    "AgentChatPanel.tsx",
    "FitnessPanel.tsx",
    "AgentPanel.tsx",
    "GateStatus.tsx",
    "AuditStream.tsx",
    "ParliamentPanel.tsx",
    "Header.tsx",
    "TrackProgress.tsx",
    "AgentQueryPanel.tsx",
  ];

  for (const component of existingComponents) {
    it(`daemon/components/${component} still exists`, () => {
      assert.ok(existsSync(resolve("daemon", "components", component)),
        `Existing component ${component} should not have been removed`);
    });
  }
});

// ═══ 7. app.tsx uses shell + views ═══════════════════════════════════

describe("app.tsx uses shell + views", () => {
  it("app.tsx imports shell reducer and view components", async () => {
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(resolve("daemon", "app.tsx"), "utf8");
    // Shell imports
    assert.ok(content.includes("./shell/app-shell"), "app.tsx should import from shell/app-shell");
    assert.ok(content.includes("./shell/navigation"), "app.tsx should import from shell/navigation");
    assert.ok(content.includes("./shell/focus-regions"), "app.tsx should import from shell/focus-regions");
    assert.ok(content.includes("./shell/shortcuts"), "app.tsx should import from shell/shortcuts");
    // View imports
    assert.ok(content.includes("./views/overview-view"), "app.tsx should import OverviewView");
    assert.ok(content.includes("./views/review-view"), "app.tsx should import ReviewView");
    assert.ok(content.includes("./views/chat-view"), "app.tsx should import ChatView");
    assert.ok(content.includes("./views/operations-view"), "app.tsx should import OperationsView");
    // Header still imported from components
    assert.ok(content.includes("./components/Header"), "Header import should remain");
  });
});
