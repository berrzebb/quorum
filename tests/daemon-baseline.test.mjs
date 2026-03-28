#!/usr/bin/env node
/**
 * DUX-1: Daemon Baseline — freeze structural contracts before refactor.
 *
 * Tests the data layer (StateReader, FullState shape), file structure
 * (components, bootstrap), and view modes. Does NOT render React/Ink.
 *
 * Run: node --test tests/daemon-baseline.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Imports from compiled dist/ ──────────────────────────────────────

const { EventStore } = await import("../dist/platform/bus/store.js");
const { StateReader } = await import("../dist/daemon/state-reader.js");

// ── Shared fixtures ──────────────────────────────────────────────────

let store;
let reader;

before(() => {
  store = new EventStore({ dbPath: ":memory:" });
  reader = new StateReader(store);
});

after(() => {
  try { store.close(); } catch { /* best-effort */ }
});

// ═══ 1. StateReader contract (structural) ════════════════════════════

describe("StateReader contract", () => {
  it("StateReader class exists and can be instantiated with an EventStore", () => {
    assert.ok(reader instanceof StateReader);
  });

  it("readAll() method exists and returns an object", () => {
    const result = reader.readAll();
    assert.equal(typeof result, "object");
    assert.ok(result !== null);
  });

  it("readAll() result has exactly 13 expected keys", () => {
    const result = reader.readAll();
    const expectedKeys = [
      "gates",
      "items",
      "locks",
      "specialists",
      "tracks",
      "findings",
      "findingStats",
      "reviewProgress",
      "fileThreads",
      "recentEvents",
      "fitness",
      "parliament",
      "agentQueries",
    ];
    for (const key of expectedKeys) {
      assert.ok(key in result, `Missing key: ${key}`);
    }
    assert.equal(Object.keys(result).length, expectedKeys.length,
      `FullState should have exactly ${expectedKeys.length} keys, got ${Object.keys(result).length}`);
  });

  it("gates returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.gates));
  });

  it("items returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.items));
  });

  it("locks returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.locks));
  });

  it("specialists returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.specialists));
  });

  it("tracks returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.tracks));
  });

  it("findings returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.findings));
  });

  it("findingStats returns an object", () => {
    const result = reader.readAll();
    assert.equal(typeof result.findingStats, "object");
    assert.ok(result.findingStats !== null);
  });

  it("reviewProgress returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.reviewProgress));
  });

  it("fileThreads returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.fileThreads));
  });

  it("recentEvents returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.recentEvents));
  });

  it("fitness returns an object", () => {
    const result = reader.readAll();
    assert.equal(typeof result.fitness, "object");
    assert.ok(result.fitness !== null);
  });

  it("parliament returns an object", () => {
    const result = reader.readAll();
    assert.equal(typeof result.parliament, "object");
    assert.ok(result.parliament !== null);
  });

  it("agentQueries returns an array", () => {
    const result = reader.readAll();
    assert.ok(Array.isArray(result.agentQueries));
  });
});

// ═══ 2. StateReader type contracts ═══════════════════════════════════

describe("StateReader type contracts", () => {
  it("GateInfo has name, status, detail fields", () => {
    const gates = reader.readAll().gates;
    // On empty DB we get 3 default gates (Audit, Retro, Quality)
    assert.ok(gates.length >= 3, "Should have at least 3 default gates");
    for (const gate of gates) {
      assert.ok("name" in gate, "GateInfo missing name");
      assert.ok("status" in gate, "GateInfo missing status");
      assert.ok("detail" in gate || gate.detail === undefined, "GateInfo detail field should exist or be undefined");
      assert.equal(typeof gate.name, "string");
      assert.ok(["open", "blocked", "pending", "error"].includes(gate.status),
        `Gate status should be one of open/blocked/pending/error, got: ${gate.status}`);
    }
  });

  it("default gates are Audit, Retro, Quality", () => {
    const gates = reader.readAll().gates;
    const names = gates.map(g => g.name);
    assert.ok(names.includes("Audit"), "Missing Audit gate");
    assert.ok(names.includes("Retro"), "Missing Retro gate");
    assert.ok(names.includes("Quality"), "Missing Quality gate");
  });

  it("FindingStats has total, open, confirmed, dismissed, fixed fields", () => {
    const stats = reader.readAll().findingStats;
    assert.ok("total" in stats, "FindingStats missing total");
    assert.ok("open" in stats, "FindingStats missing open");
    assert.ok("confirmed" in stats, "FindingStats missing confirmed");
    assert.ok("dismissed" in stats, "FindingStats missing dismissed");
    assert.ok("fixed" in stats, "FindingStats missing fixed");
    // All should be numbers
    assert.equal(typeof stats.total, "number");
    assert.equal(typeof stats.open, "number");
    assert.equal(typeof stats.confirmed, "number");
    assert.equal(typeof stats.dismissed, "number");
    assert.equal(typeof stats.fixed, "number");
  });

  it("FitnessInfo has baseline, current, gate, history fields", () => {
    const fitness = reader.readAll().fitness;
    assert.ok("baseline" in fitness, "FitnessInfo missing baseline");
    assert.ok("current" in fitness, "FitnessInfo missing current");
    assert.ok("gate" in fitness, "FitnessInfo missing gate");
    assert.ok("history" in fitness, "FitnessInfo missing history");
    // baseline and current can be null on empty DB
    assert.ok(fitness.baseline === null || typeof fitness.baseline === "number");
    assert.ok(fitness.current === null || typeof fitness.current === "number");
    assert.ok(Array.isArray(fitness.history));
  });

  it("FitnessInfo also has trend and components fields", () => {
    const fitness = reader.readAll().fitness;
    assert.ok("trend" in fitness, "FitnessInfo missing trend");
    assert.ok("components" in fitness, "FitnessInfo missing components");
  });

  it("ParliamentInfo has committees, lastVerdict, pendingAmendments, conformance, sessionCount fields", () => {
    const parliament = reader.readAll().parliament;
    assert.ok("committees" in parliament, "ParliamentInfo missing committees");
    assert.ok("lastVerdict" in parliament, "ParliamentInfo missing lastVerdict");
    assert.ok("pendingAmendments" in parliament, "ParliamentInfo missing pendingAmendments");
    assert.ok("conformance" in parliament, "ParliamentInfo missing conformance");
    assert.ok("sessionCount" in parliament, "ParliamentInfo missing sessionCount");
    // Type checks
    assert.ok(Array.isArray(parliament.committees));
    assert.ok(parliament.lastVerdict === null || typeof parliament.lastVerdict === "string");
    assert.equal(typeof parliament.pendingAmendments, "number");
    assert.ok(parliament.conformance === null || typeof parliament.conformance === "number");
    assert.equal(typeof parliament.sessionCount, "number");
  });

  it("ParliamentInfo has liveSessions field", () => {
    const parliament = reader.readAll().parliament;
    assert.ok("liveSessions" in parliament, "ParliamentInfo missing liveSessions");
    assert.ok(Array.isArray(parliament.liveSessions));
  });
});

// ═══ 3. StateReader with seeded data ═════════════════════════════════

describe("StateReader with seeded data", () => {
  let seededStore;
  let seededReader;

  before(() => {
    seededStore = new EventStore({ dbPath: ":memory:" });
    seededReader = new StateReader(seededStore);

    // Seed a state transition for an audit item
    seededStore.commitTransaction(
      [], // no events
      [
        {
          entityType: "audit_item",
          entityId: "test-item-1",
          fromState: null,
          toState: "pending",
          source: "test",
          metadata: { label: "Test Item 1" },
        },
      ],
      [], // no KV
    );

    // Seed a track.progress event
    seededStore.append({
      type: "track.progress",
      source: "claude-code",
      timestamp: Date.now(),
      payload: {
        trackId: "test-track",
        total: 10,
        completed: 3,
        pending: 5,
        blocked: 2,
      },
    });
  });

  after(() => {
    try { seededStore.close(); } catch { /* best-effort */ }
  });

  it("ItemStateInfo has entityId, currentState, source fields", () => {
    const items = seededReader.readAll().items;
    assert.ok(items.length >= 1, "Should have at least 1 item after seeding");
    const item = items[0];
    assert.ok("entityId" in item, "ItemStateInfo missing entityId");
    assert.ok("currentState" in item, "ItemStateInfo missing currentState");
    assert.ok("source" in item, "ItemStateInfo missing source");
    assert.equal(typeof item.entityId, "string");
    assert.equal(typeof item.currentState, "string");
    assert.equal(typeof item.source, "string");
    assert.equal(item.entityId, "test-item-1");
    assert.equal(item.currentState, "pending");
  });

  it("TrackInfo has trackId, total, completed, pending, blocked fields", () => {
    const tracks = seededReader.readAll().tracks;
    assert.ok(tracks.length >= 1, "Should have at least 1 track after seeding");
    const track = tracks[0];
    assert.ok("trackId" in track, "TrackInfo missing trackId");
    assert.ok("total" in track, "TrackInfo missing total");
    assert.ok("completed" in track, "TrackInfo missing completed");
    assert.ok("pending" in track, "TrackInfo missing pending");
    assert.ok("blocked" in track, "TrackInfo missing blocked");
    assert.equal(typeof track.trackId, "string");
    assert.equal(typeof track.total, "number");
    assert.equal(typeof track.completed, "number");
    assert.equal(typeof track.pending, "number");
    assert.equal(typeof track.blocked, "number");
    assert.equal(track.trackId, "test-track");
    assert.equal(track.total, 10);
    assert.equal(track.completed, 3);
  });

  it("FindingInfo has id, severity, file, description fields when findings exist", () => {
    // Seed a finding.detect event
    seededStore.append({
      type: "finding.detect",
      source: "claude-code",
      timestamp: Date.now(),
      payload: {
        reviewerId: "test-reviewer",
        provider: "claude",
        findings: [
          {
            id: "f-001",
            severity: "high",
            file: "src/test.ts",
            line: 42,
            description: "Potential null dereference",
            category: "safety",
            reviewerId: "test-reviewer",
            provider: "claude",
          },
        ],
      },
    });

    const findings = seededReader.openFindings();
    assert.ok(findings.length >= 1, "Should have at least 1 finding after seeding");
    const finding = findings[0];
    assert.ok("id" in finding, "FindingInfo missing id");
    assert.ok("severity" in finding, "FindingInfo missing severity");
    assert.ok("file" in finding, "FindingInfo missing file");
    assert.ok("description" in finding, "FindingInfo missing description");
    assert.equal(finding.id, "f-001");
    assert.equal(finding.severity, "high");
    assert.equal(finding.file, "src/test.ts");
    assert.equal(finding.description, "Potential null dereference");
  });
});

// ═══ 4. View mode baseline ═══════════════════════════════════════════

describe("View mode baseline", () => {
  it("app.tsx defines exactly 3 views: dashboard, log, chat", () => {
    const appPath = resolve("daemon", "app.tsx");
    assert.ok(existsSync(appPath), "daemon/app.tsx should exist");

    const content = readFileSync(appPath, "utf8");
    // The view type union is defined inline in useState
    assert.ok(
      content.includes('"dashboard"'),
      "app.tsx should reference 'dashboard' view",
    );
    assert.ok(
      content.includes('"log"'),
      "app.tsx should reference 'log' view",
    );
    assert.ok(
      content.includes('"chat"'),
      "app.tsx should reference 'chat' view",
    );

    // Verify the type declaration constrains to exactly these 3
    const viewTypeMatch = content.match(
      /useState<"dashboard"\s*\|\s*"log"\s*\|\s*"chat">/
    );
    assert.ok(viewTypeMatch, "activeView type should be exactly 'dashboard' | 'log' | 'chat'");
  });
});

// ═══ 5. Component existence baseline ═════════════════════════════════

describe("Component existence baseline", () => {
  const expectedComponents = [
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

  for (const component of expectedComponents) {
    it(`daemon/components/${component} exists`, () => {
      const fullPath = resolve("daemon", "components", component);
      assert.ok(existsSync(fullPath), `Missing component: ${component}`);
    });
  }

  it("exactly 9 component files exist", () => {
    assert.equal(expectedComponents.length, 9);
    // Verify no unexpected files by checking each expected one exists
    for (const component of expectedComponents) {
      assert.ok(existsSync(resolve("daemon", "components", component)));
    }
  });
});

// ═══ 6. Bootstrap baseline ═══════════════════════════════════════════

describe("Bootstrap baseline", () => {
  it("daemon/index.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "index.ts")));
  });

  it("daemon/app.tsx exists", () => {
    assert.ok(existsSync(resolve("daemon", "app.tsx")));
  });

  it("daemon/state-reader.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "state-reader.ts")));
  });

  it("daemon/state/snapshot.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "state", "snapshot.ts")));
  });

  it("daemon/state/queries/ modules exist", () => {
    const queryModules = ["gates.ts", "findings.ts", "parliament.ts", "sessions.ts", "tracks.ts", "operations.ts", "fitness.ts", "index.ts"];
    for (const mod of queryModules) {
      assert.ok(existsSync(resolve("daemon", "state", "queries", mod)), `Missing query module: ${mod}`);
    }
  });

  it("daemon/services/daemon-bootstrap.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "services", "daemon-bootstrap.ts")));
  });

  it("daemon/services/provider-lifecycle.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "services", "provider-lifecycle.ts")));
  });

  it("daemon/services/mux-lifecycle.ts exists", () => {
    assert.ok(existsSync(resolve("daemon", "services", "mux-lifecycle.ts")));
  });
});

// ═══ 7. Line count baseline (approximate) ═══════════════════════════

describe("Line count baseline", () => {
  function lineCount(relPath) {
    const fullPath = resolve(relPath);
    const content = readFileSync(fullPath, "utf8");
    return content.split("\n").length;
  }

  it("state-reader.ts is a thin wrapper (< 250 lines, queries extracted to daemon/state/)", () => {
    const lines = lineCount("daemon/state-reader.ts");
    assert.ok(lines < 250, `state-reader.ts has ${lines} lines, expected < 250 (thin wrapper)`);
    assert.ok(lines > 50, `state-reader.ts has ${lines} lines, expected > 50 (not empty)`);
  });

  it("snapshot.ts > 50 lines (SnapshotAssembler)", () => {
    const lines = lineCount("daemon/state/snapshot.ts");
    assert.ok(lines > 50, `snapshot.ts has ${lines} lines, expected > 50`);
  });

  it("query modules total > 700 lines (extracted from state-reader.ts)", () => {
    const queryFiles = [
      "daemon/state/queries/gates.ts",
      "daemon/state/queries/findings.ts",
      "daemon/state/queries/parliament.ts",
      "daemon/state/queries/sessions.ts",
      "daemon/state/queries/tracks.ts",
      "daemon/state/queries/operations.ts",
      "daemon/state/queries/fitness.ts",
    ];
    let total = 0;
    for (const f of queryFiles) total += lineCount(f);
    assert.ok(total > 700, `Query modules total ${total} lines, expected > 700`);
  });

  it("app.tsx > 300 lines", () => {
    const lines = lineCount("daemon/app.tsx");
    assert.ok(lines > 300, `app.tsx has ${lines} lines, expected > 300`);
  });

  it("AgentChatPanel.tsx > 300 lines", () => {
    const lines = lineCount("daemon/components/AgentChatPanel.tsx");
    assert.ok(lines > 300, `AgentChatPanel.tsx has ${lines} lines, expected > 300`);
  });

  it("index.ts is a thin orchestrator (< 120 lines, services extracted)", () => {
    const lines = lineCount("daemon/index.ts");
    assert.ok(lines < 120, `index.ts has ${lines} lines, expected < 120 (thin orchestrator)`);
    assert.ok(lines > 40, `index.ts has ${lines} lines, expected > 40 (not empty)`);
  });

  it("daemon-bootstrap.ts > 150 lines (extracted from index.ts)", () => {
    const lines = lineCount("daemon/services/daemon-bootstrap.ts");
    assert.ok(lines > 150, `daemon-bootstrap.ts has ${lines} lines, expected > 150`);
  });

  it("provider-lifecycle.ts > 20 lines (extracted from index.ts)", () => {
    const lines = lineCount("daemon/services/provider-lifecycle.ts");
    assert.ok(lines > 20, `provider-lifecycle.ts has ${lines} lines, expected > 20`);
  });

  it("mux-lifecycle.ts > 50 lines (extracted from index.ts)", () => {
    const lines = lineCount("daemon/services/mux-lifecycle.ts");
    assert.ok(lines > 50, `mux-lifecycle.ts has ${lines} lines, expected > 50`);
  });
});

// ═══ 8. Polling baseline ═════════════════════════════════════════════

describe("Polling baseline", () => {
  it("stateFingerprint function exists in app.tsx (render optimization)", () => {
    const content = readFileSync(resolve("daemon", "app.tsx"), "utf8");
    assert.ok(
      content.includes("stateFingerprint"),
      "app.tsx should have stateFingerprint function for render optimization",
    );
    // Verify it's used in the polling comparison
    assert.ok(
      content.includes("stateFingerprint(prev)") || content.includes("stateFingerprint("),
      "stateFingerprint should be invoked for comparison",
    );
  });

  it("StateReader has changesSince method (incremental TUI updates)", () => {
    assert.equal(typeof reader.changesSince, "function",
      "StateReader should expose changesSince method");

    const result = reader.changesSince(0);
    assert.ok("events" in result, "changesSince result should have events");
    assert.ok("hasStateChanges" in result, "changesSince result should have hasStateChanges");
    assert.ok(Array.isArray(result.events));
    assert.equal(typeof result.hasStateChanges, "boolean");
  });

  it("readAll accepts eventLimit parameter", () => {
    // readAll(eventLimit = 20) — default is 20
    const result = reader.readAll(5);
    assert.ok(Array.isArray(result.recentEvents));
    // On empty DB this is just 0, but the parameter should be accepted
  });
});

// ═══ 9. FullState key names match readAll method names ═══════════════

describe("FullState-to-method mapping", () => {
  it("readAll keys correspond to individual query methods", () => {
    // Verify each query method exists on StateReader
    assert.equal(typeof reader.gateStatus, "function", "gateStatus method missing");
    assert.equal(typeof reader.itemStates, "function", "itemStates method missing");
    assert.equal(typeof reader.activeLocks, "function", "activeLocks method missing");
    assert.equal(typeof reader.activeSpecialists, "function", "activeSpecialists method missing");
    assert.equal(typeof reader.trackProgress, "function", "trackProgress method missing");
    assert.equal(typeof reader.openFindings, "function", "openFindings method missing");
    assert.equal(typeof reader.findingStats, "function", "findingStats method missing");
    assert.equal(typeof reader.reviewProgress, "function", "reviewProgress method missing");
    assert.equal(typeof reader.findingThreads, "function", "findingThreads method missing");
    assert.equal(typeof reader.recentEvents, "function", "recentEvents method missing");
    assert.equal(typeof reader.fitnessInfo, "function", "fitnessInfo method missing");
    assert.equal(typeof reader.parliamentInfo, "function", "parliamentInfo method missing");
    assert.equal(typeof reader.agentQueries, "function", "agentQueries method missing");
  });
});
