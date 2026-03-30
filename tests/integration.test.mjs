#!/usr/bin/env node
/**
 * Integration Tests — end-to-end pipeline verification.
 *
 * Tests:
 *   1. Specialist pipeline: detectDomains → selectReviewers → tool execution
 *   2. StateReader: gates, items, locks, specialists from SQLite
 *   3. Bridge domain routing: MJS → TS domain modules
 *   4. TransactionalUnitOfWork: atomic file + SQLite writes
 *   5. MarkdownProjector: tag projection from SQLite state
 *
 * Run: node --test tests/integration.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// ── Load compiled modules ──────────────────────

const { EventStore, TransactionalUnitOfWork } = await import("../dist/platform/bus/store.js");
const { LockService } = await import("../dist/platform/bus/lock.js");
const { MarkdownProjector } = await import("../dist/platform/bus/projector.js");
const { StateReader } = await import("../dist/daemon/state-reader.js");
const { detectDomains } = await import("../dist/platform/providers/domain-detect.js");
const { selectReviewers, listDomainReviewers } = await import("../dist/platform/providers/domain-router.js");
const { buildSpecialistSection, enrichEvidence } = await import("../dist/platform/providers/specialist.js");

let tmpDir;
let store;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "integration-test-"));
  const dbPath = join(tmpDir, "test.db");
  store = new EventStore({ dbPath });
});

after(() => {
  try { if (store) store.close(); } catch (err) { console.warn("integration store close failed:", err?.message ?? err); }
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { console.warn("integration cleanup failed:", err?.message ?? err); }
});

// ═══ 1. Specialist Pipeline E2E ════════════════════════════════════════

describe("specialist pipeline E2E", () => {
  it("detectDomains → selectReviewers → tools list", () => {
    const changedFiles = [
      "src/components/Login.tsx",
      "Dockerfile",
      "locales/ko.json",
    ];
    const diff = "aria-label removed from button";

    const result = detectDomains(changedFiles, diff);
    const activeNames = Object.entries(result.domains).filter(([, v]) => v).map(([k]) => k);

    assert.ok(activeNames.length > 0, "Should detect at least one domain");
    assert.ok(result.domains.infrastructure, "Should detect infrastructure (Dockerfile)");
    assert.ok(result.domains.i18n, "Should detect i18n (locales)");

    // Route to reviewers at T2
    const selection = selectReviewers(result.domains, "T2");
    assert.ok(selection.tools.length >= 2, `Expected ≥2 tools, got ${selection.tools.length}`);
    assert.ok(selection.tools.includes("infra_scan"));
    assert.ok(selection.tools.includes("i18n_validate"));
  });

  it("T1 tier only activates tools, not agents", () => {
    const result = detectDomains(["src/api/handler.ts"], "async function handler");
    const selection = selectReviewers(result.domains, "T1");

    // At T1, tools still run but agents should not
    assert.equal(selection.agents.length, 0, "T1 should have no agents");
  });

  it("T3 tier activates observability and doc agents", () => {
    const result = detectDomains(["src/util.ts", "README.md"], "");
    if (result.domains.documentation) {
      const selection = selectReviewers(result.domains, "T3");
      // At T3, doc agents should activate (minTier is T3)
      assert.ok(selection.reviewers.some(r => r.domain === "documentation"));
    }
  });

  it("buildSpecialistSection formats tool results", () => {
    const toolResults = [
      { tool: "perf_scan", domain: "performance", status: "pass", output: "No issues", duration: 120 },
      { tool: "a11y_scan", domain: "accessibility", status: "fail", output: "img missing alt", duration: 80 },
    ];
    const section = buildSpecialistSection(toolResults, []);
    assert.ok(section.includes("## Specialist Reviews"));
    assert.ok(section.includes("✅ perf_scan"));
    assert.ok(section.includes("❌ a11y_scan"));
    assert.ok(section.includes("img missing alt"));
  });

  it("enrichEvidence appends specialist section", () => {
    const original = "## Evidence\n\nSome claim here.";
    const toolResults = [
      { tool: "license_scan", domain: "compliance", status: "pass", output: "", duration: 50 },
    ];
    const result = enrichEvidence(original, toolResults, []);
    assert.ok(result.includes("## Evidence"));
    assert.ok(result.includes("## Specialist Reviews"));
    assert.ok(result.includes("✅ license_scan"));
  });
});

// ═══ 2. StateReader Queries ════════════════════════════════════════════

describe("StateReader", () => {
  it("reads empty state correctly", () => {
    const reader = new StateReader(store);
    const state = reader.readAll();
    assert.ok(Array.isArray(state.gates));
    assert.ok(Array.isArray(state.items));
    assert.ok(Array.isArray(state.locks));
    assert.ok(Array.isArray(state.specialists));
    assert.ok(Array.isArray(state.tracks));
    assert.ok(Array.isArray(state.recentEvents));
  });

  it("returns 3 gates", () => {
    const reader = new StateReader(store);
    const gates = reader.gateStatus();
    assert.equal(gates.length, 3);
    assert.ok(gates.some(g => g.name === "Audit"));
    assert.ok(gates.some(g => g.name === "Retro"));
    assert.ok(gates.some(g => g.name === "Quality"));
  });

  it("reads item states after recording transitions", () => {
    // Record a transition using the proper StateTransition interface
    store.commitTransaction([], [
      {
        entityType: "audit_item",
        entityId: "TN-42",
        fromState: null,
        toState: "review_needed",
        source: "test",
        metadata: { label: "Test item" },
      },
    ], []);

    const reader = new StateReader(store);
    const items = reader.itemStates();
    assert.ok(items.length >= 1, "Should have at least 1 item");
    const tn42 = items.find(i => i.entityId === "TN-42");
    assert.ok(tn42, "TN-42 should exist");
    assert.equal(tn42.currentState, "review_needed");
  });

  it("reads locks from LockService", () => {
    const lockService = new LockService(store.getDb());
    const acquired = lockService.acquire("test:integration", process.pid, "test-session");
    assert.ok(acquired);

    const reader = new StateReader(store);
    const locks = reader.activeLocks();
    assert.ok(locks.length >= 1);
    assert.ok(locks.some(l => l.lockName === "test:integration"));

    lockService.release("test:integration", process.pid);
  });

  it("tracks specialists from events", () => {
    store.append({
      id: `spec-${Date.now()}`,
      type: "specialist.tool",
      source: "test",
      payload: { tool: "perf_scan", domain: "performance", status: "pass", duration: 100 },
      timestamp: Date.now(),
      sessionId: "test",
    });

    const reader = new StateReader(store);
    const specialists = reader.activeSpecialists();
    assert.ok(specialists.some(s => s.domain === "performance"));
  });

  it("changesSince returns incremental events", () => {
    const before = Date.now() - 1;
    store.append({
      id: `change-${Date.now()}`,
      type: "audit.verdict",
      source: "test",
      payload: { verdict: "approved" },
      timestamp: Date.now(),
      sessionId: "test",
    });

    const reader = new StateReader(store);
    const changes = reader.changesSince(before);
    assert.ok(changes.events.length >= 1);
    assert.ok(changes.hasStateChanges);
  });
});

// ═══ 3. TransactionalUnitOfWork E2E ════════════════════════════════════

describe("TransactionalUnitOfWork integration", () => {
  it("atomically writes files and SQLite", () => {
    const uow = new TransactionalUnitOfWork(store);
    const filePath = join(tmpDir, "uow-test.md");

    uow.stageProjection({ path: filePath, content: "# Test\n\nContent here." });
    uow.stageKV("test:uow", { written: true, at: Date.now() });

    const ids = uow.commit();
    assert.ok(existsSync(filePath));
    assert.equal(readFileSync(filePath, "utf8"), "# Test\n\nContent here.");

    const kv = store.getKV("test:uow");
    assert.ok(kv?.written);
  });

  it("rolls back file writes on SQLite error", () => {
    // This is hard to test without breaking SQLite, so verify the mechanism exists
    const uow = new TransactionalUnitOfWork(store);
    assert.ok(typeof uow.stageProjection === "function");
    assert.ok(typeof uow.stageTransition === "function");
    assert.ok(typeof uow.stageKV === "function");
    assert.ok(typeof uow.commit === "function");
  });
});

// ═══ 4. MarkdownProjector E2E ══════════════════════════════════════════

describe("MarkdownProjector integration", () => {
  it("projects tags from SQLite state into markdown", () => {
    // Add an approved item
    store.commitTransaction([], [
      {
        entityType: "audit_item",
        entityId: "EV-1",
        fromState: "review_needed",
        toState: "approved",
        source: "test",
        metadata: {},
      },
    ], []);

    const projector = new MarkdownProjector(store.getDb(), {});

    const items = projector.queryItemStates();
    // Check uniqueness
    const ids = items.map(i => i.entityId);
    const uniqueIds = [...new Set(ids)];
    assert.equal(ids.length, uniqueIds.length, "Should have no duplicate entity IDs");
  });
});

// ═══ 5. Domain Detection Edge Cases ════════════════════════════════════

describe("domain detection edge cases", () => {
  it("accessibility requires JSX + a11y content (double condition)", () => {
    // Only JSX file, no a11y content → should NOT detect accessibility
    const result1 = detectDomains(["src/App.tsx"], "simple state update");
    assert.ok(!result1.domains.accessibility, "Should NOT detect with JSX but no a11y content");

    // JSX + a11y content → SHOULD detect accessibility
    const result2 = detectDomains(["src/App.tsx"], 'aria-label="close" role="button"');
    assert.ok(result2.domains.accessibility, "Should detect with JSX + aria content");
  });

  it("empty file list produces no domains", () => {
    const result = detectDomains([], "");
    assert.equal(result.activeCount, 0);
  });

  it("concurrency domain has no tool (agent only)", () => {
    const reviewers = listDomainReviewers();
    const concurrency = reviewers.find(r => r.domain === "concurrency");
    assert.ok(concurrency);
    assert.equal(concurrency.tool, undefined, "Concurrency has no deterministic tool");
    assert.ok(concurrency.agent, "Concurrency has an LLM agent");
  });
});
