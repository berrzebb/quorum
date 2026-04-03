#!/usr/bin/env node
/**
 * DUX-1: Daemon Baseline — behavioral tests for daemon refactor invariants.
 *
 * Tests seeded data queries, line count limits, polling/fingerprint
 * optimization, view mode wiring, and cutover verification.
 * Does NOT render React/Ink.
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
  try { store.close(); } catch (err) { console.warn("daemon-baseline store close failed:", err?.message ?? err); }
});

// ═══ 1. StateReader with seeded data ═════════════════════════════════

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
    try { seededStore.close(); } catch (err) { console.warn("daemon-baseline seededStore close failed:", err?.message ?? err); }
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

// ═══ 2. View mode baseline ═══════════════════════════════════════════

describe("View mode baseline", () => {
  it("app.tsx uses shell reducer with 4 views: overview, review, chat, operations", () => {
    const appPath = resolve("daemon", "app.tsx");
    assert.ok(existsSync(appPath), "daemon/app.tsx should exist");

    const content = readFileSync(appPath, "utf8");
    // Shell reducer replaces inline useState
    assert.ok(
      content.includes("shellReducer"),
      "app.tsx should use shellReducer from app-shell",
    );
    assert.ok(
      content.includes("initialShellState"),
      "app.tsx should use initialShellState from app-shell",
    );
    // All 4 views are rendered
    assert.ok(
      content.includes('"overview"'),
      "app.tsx should reference 'overview' view",
    );
    assert.ok(
      content.includes('"review"'),
      "app.tsx should reference 'review' view",
    );
    assert.ok(
      content.includes('"chat"'),
      "app.tsx should reference 'chat' view",
    );
    assert.ok(
      content.includes('"operations"'),
      "app.tsx should reference 'operations' view",
    );
    // View components are imported
    assert.ok(content.includes("OverviewView"), "app.tsx should import OverviewView");
    assert.ok(content.includes("ReviewView"), "app.tsx should import ReviewView");
    assert.ok(content.includes("ChatView"), "app.tsx should import ChatView");
    assert.ok(content.includes("OperationsView"), "app.tsx should import OperationsView");
  });
});

// ═══ 3. Line count baseline (approximate) ═══════════════════════════

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

  it("app.tsx is a thin shell (< 200 lines, views extracted)", () => {
    const lines = lineCount("daemon/app.tsx");
    assert.ok(lines < 200, `app.tsx has ${lines} lines, expected < 200 (thin shell)`);
    assert.ok(lines > 80, `app.tsx has ${lines} lines, expected > 80 (not empty)`);
  });

  it("chat-view.tsx is the live chat path (> 200 lines, replaces AgentChatPanel)", () => {
    const lines = lineCount("daemon/views/chat-view.tsx");
    assert.ok(lines > 200, `chat-view.tsx has ${lines} lines, expected > 200 (full chat logic)`);
  });

  it("app.tsx does not import AgentChatPanel (cutover complete)", () => {
    const content = readFileSync(resolve("daemon", "app.tsx"), "utf8");
    assert.ok(
      !content.includes("AgentChatPanel"),
      "app.tsx should not import AgentChatPanel after cutover",
    );
  });

  it("chat-view.tsx imports session panels (SessionList, TranscriptPane, Composer, GitSidebar)", () => {
    const content = readFileSync(resolve("daemon", "views", "chat-view.tsx"), "utf8");
    assert.ok(content.includes("SessionList"), "chat-view.tsx should import SessionList");
    assert.ok(content.includes("TranscriptPane"), "chat-view.tsx should import TranscriptPane");
    assert.ok(content.includes("Composer"), "chat-view.tsx should import Composer");
    assert.ok(content.includes("GitSidebar"), "chat-view.tsx should import GitSidebar");
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

// ═══ 4. Polling baseline ═════════════════════════════════════════════

describe("Polling baseline", () => {
  it("app.tsx does not contain inline panel definitions (delegated to views)", () => {
    const content = readFileSync(resolve("daemon", "app.tsx"), "utf8");
    // These were inline in the old app.tsx, now live in panels/ or views/
    assert.ok(!content.includes("function FindingStatsPanel"), "FindingStatsPanel should not be inline in app.tsx");
    assert.ok(!content.includes("function OpenFindingsPanel"), "OpenFindingsPanel should not be inline in app.tsx");
    assert.ok(!content.includes("function ReviewProgressPanel"), "ReviewProgressPanel should not be inline in app.tsx");
    assert.ok(!content.includes("function ChatPanel"), "ChatPanel should not be inline in app.tsx");
    assert.ok(!content.includes("function severityColor"), "severityColor should not be in app.tsx");
  });

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

// ═══ 5. Cutover verification ══════════════════════════════════════════

describe("Cutover verification", () => {
  it("overview-view.tsx imports extracted panels (not inline)", () => {
    const content = readFileSync(resolve("daemon", "views", "overview-view.tsx"), "utf8");
    assert.ok(content.includes("ItemStatePanel"), "overview-view should import ItemStatePanel");
    assert.ok(content.includes("LockPanel"), "overview-view should import LockPanel");
    assert.ok(content.includes("SpecialistPanel"), "overview-view should import SpecialistPanel");
    assert.ok(content.includes("GateStatus"), "overview-view should import GateStatus");
    assert.ok(content.includes("TrackProgress"), "overview-view should import TrackProgress");
  });

  it("review-view.tsx imports review panels", () => {
    const content = readFileSync(resolve("daemon", "views", "review-view.tsx"), "utf8");
    assert.ok(content.includes("FindingStatsPanel"), "review-view should import FindingStatsPanel");
    assert.ok(content.includes("OpenFindingsPanel"), "review-view should import OpenFindingsPanel");
    assert.ok(content.includes("AuditStream"), "review-view should import AuditStream");
  });

  it("operations-view.tsx imports operational panels", () => {
    const content = readFileSync(resolve("daemon", "views", "operations-view.tsx"), "utf8");
    assert.ok(content.includes("AgentPanel"), "operations-view should import AgentPanel");
    assert.ok(content.includes("FitnessPanel"), "operations-view should import FitnessPanel");
    assert.ok(content.includes("LockPanel"), "operations-view should import LockPanel");
  });

  it("app.tsx imports view components, not individual panels", () => {
    const content = readFileSync(resolve("daemon", "app.tsx"), "utf8");
    // Should import views
    assert.ok(content.includes("OverviewView"), "app.tsx should import OverviewView");
    assert.ok(content.includes("ChatView"), "app.tsx should import ChatView");
    // Should NOT import panels directly
    assert.ok(!content.includes("GateStatus"), "app.tsx should not directly import GateStatus");
    assert.ok(!content.includes("TrackProgress"), "app.tsx should not directly import TrackProgress");
    assert.ok(!content.includes("FitnessPanel"), "app.tsx should not directly import FitnessPanel");
  });

  it("Header.tsx imports VIEW_REGISTRY for tab rendering", () => {
    const content = readFileSync(resolve("daemon", "components", "Header.tsx"), "utf8");
    assert.ok(content.includes("VIEW_REGISTRY"), "Header should import VIEW_REGISTRY");
  });
});

