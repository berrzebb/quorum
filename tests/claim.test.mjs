#!/usr/bin/env node
/**
 * Phase 4 Tests: ClaimService + ParallelPlanner + OrchestratorMode
 *
 * Run: node --test tests/claim.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";

import { createTempStore, cleanup } from "./helpers.mjs";

const { ClaimService } = await import("../dist/platform/bus/claim.js");
const { planParallel, validateAgainstClaims } = await import("../dist/platform/bus/parallel.js");
const { selectMode } = await import("../dist/platform/bus/orchestrator.js");

// ═══ 1. ClaimService ═══════════════════════════════════════════════

describe("ClaimService", () => {
  let store, dir, claimService;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    claimService = new ClaimService(store.getDb());
  });

  it("claims files with no conflicts", () => {
    const conflicts = claimService.claimFiles("agent-1", ["src/a.ts", "src/b.ts"]);
    assert.equal(conflicts.length, 0);

    const claims = claimService.getClaims("agent-1");
    assert.equal(claims.length, 2);
    assert.equal(claims[0].agentId, "agent-1");
  });

  it("blocks conflicting claims from different agents", () => {
    claimService.claimFiles("agent-1", ["src/a.ts", "src/b.ts"]);
    const conflicts = claimService.claimFiles("agent-2", ["src/b.ts", "src/c.ts"]);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].filePath, "src/b.ts");
    assert.equal(conflicts[0].heldBy, "agent-1");

    // All-or-nothing: agent-2 should have no claims
    const agent2Claims = claimService.getClaims("agent-2");
    assert.equal(agent2Claims.length, 0);
  });

  it("allows same agent to re-claim (idempotent)", () => {
    claimService.claimFiles("agent-1", ["src/a.ts"]);
    const conflicts = claimService.claimFiles("agent-1", ["src/a.ts", "src/b.ts"]);
    assert.equal(conflicts.length, 0);

    const claims = claimService.getClaims("agent-1");
    assert.equal(claims.length, 2);
  });

  it("releases all files by agent", () => {
    claimService.claimFiles("agent-1", ["src/a.ts", "src/b.ts", "src/c.ts"]);
    const released = claimService.releaseFiles("agent-1");
    assert.equal(released, 3);

    // Now agent-2 can claim those files
    const conflicts = claimService.claimFiles("agent-2", ["src/a.ts"]);
    assert.equal(conflicts.length, 0);
  });

  it("releases specific file path", () => {
    claimService.claimFiles("agent-1", ["src/a.ts", "src/b.ts"]);
    const released = claimService.releasePath("src/a.ts");
    assert.equal(released, true);

    // a.ts free, b.ts still held
    const conflicts = claimService.claimFiles("agent-2", ["src/a.ts"]);
    assert.equal(conflicts.length, 0);
    const conflictsB = claimService.claimFiles("agent-2", ["src/b.ts"]);
    assert.equal(conflictsB.length, 1);
  });

  it("checkConflicts is read-only", () => {
    claimService.claimFiles("agent-1", ["src/a.ts"]);
    const conflicts = claimService.checkConflicts("agent-2", ["src/a.ts", "src/b.ts"]);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].filePath, "src/a.ts");

    // No claims created for agent-2
    assert.equal(claimService.getClaims("agent-2").length, 0);
  });

  it("expired claims are ignored", () => {
    claimService.claimFiles("agent-1", ["src/a.ts"], undefined, 1000);
    // Backdate to make expired
    store.getDb().prepare(
      `UPDATE file_claims SET claimed_at = 0, ttl_ms = 1 WHERE file_path = ?`
    ).run("src/a.ts");

    // agent-2 can claim the expired file
    const conflicts = claimService.claimFiles("agent-2", ["src/a.ts"]);
    assert.equal(conflicts.length, 0);
  });

  it("cleanExpired removes stale claims", () => {
    claimService.claimFiles("agent-1", ["src/a.ts", "src/b.ts"]);
    store.getDb().prepare(
      `UPDATE file_claims SET claimed_at = 0, ttl_ms = 1`
    ).run();

    const cleaned = claimService.cleanExpired();
    assert.equal(cleaned, 2);
    assert.equal(claimService.getClaims().length, 0);
  });

  it("getClaims without agentId returns all active", () => {
    claimService.claimFiles("agent-1", ["src/a.ts"]);
    claimService.claimFiles("agent-2", ["src/b.ts"]);

    const all = claimService.getClaims();
    assert.equal(all.length, 2);
  });

  it("stores session ID with claims", () => {
    claimService.claimFiles("agent-1", ["src/a.ts"], "session-xyz");
    const claims = claimService.getClaims("agent-1");
    assert.equal(claims[0].sessionId, "session-xyz");
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});

// ═══ 2. ParallelPlanner ═══════════════════════════════════════════

describe("ParallelPlanner", () => {
  it("empty input returns empty plan", () => {
    const result = planParallel([]);
    assert.equal(result.depth, 0);
    assert.equal(result.maxWidth, 0);
    assert.equal(result.groups.length, 0);
  });

  it("independent items go in one group", () => {
    const result = planParallel([
      { id: "A", targetFiles: ["a.ts"] },
      { id: "B", targetFiles: ["b.ts"] },
      { id: "C", targetFiles: ["c.ts"] },
    ]);

    assert.equal(result.depth, 1);
    assert.equal(result.maxWidth, 3);
    assert.equal(result.groups[0].items.length, 3);
  });

  it("conflicting items go in separate groups", () => {
    const result = planParallel([
      { id: "A", targetFiles: ["shared.ts", "a.ts"] },
      { id: "B", targetFiles: ["shared.ts", "b.ts"] },
    ]);

    assert.equal(result.depth, 2);
    assert.equal(result.maxWidth, 1);
  });

  it("mixed: some parallel, some serial", () => {
    const result = planParallel([
      { id: "A", targetFiles: ["a.ts"] },
      { id: "B", targetFiles: ["b.ts"] },
      { id: "C", targetFiles: ["a.ts", "c.ts"] }, // conflicts with A
    ]);

    assert.equal(result.depth, 2);
    // First group should have B + either A or C, second group the other
    const totalScheduled = result.groups.reduce((s, g) => s + g.items.length, 0);
    assert.equal(totalScheduled, 3);
  });

  it("respects explicit dependsOn", () => {
    const result = planParallel([
      { id: "A", targetFiles: ["a.ts"] },
      { id: "B", targetFiles: ["b.ts"], dependsOn: ["A"] },
    ]);

    // B must come after A even though no file conflict
    assert.equal(result.depth, 2);
    assert.equal(result.groups[0].items[0].id, "A");
    assert.equal(result.groups[1].items[0].id, "B");
  });

  it("detects circular dependencies as unschedulable", () => {
    const result = planParallel([
      { id: "A", targetFiles: ["a.ts"], dependsOn: ["B"] },
      { id: "B", targetFiles: ["b.ts"], dependsOn: ["A"] },
    ]);

    assert.equal(result.unschedulable.length, 2);
  });

  it("groups track correct files", () => {
    const result = planParallel([
      { id: "A", targetFiles: ["a.ts", "shared.ts"] },
      { id: "B", targetFiles: ["b.ts"] },
    ]);

    const group = result.groups[0];
    assert.ok(group.files.includes("a.ts") || group.files.includes("b.ts"));
  });

  it("validates against live claims", () => {
    const { store, dir } = createTempStore();
    const claimService = new ClaimService(store.getDb());

    // External agent holds src/x.ts
    claimService.claimFiles("external-agent", ["src/x.ts"]);

    const plan = planParallel([
      { id: "A", targetFiles: ["src/x.ts"] },
      { id: "B", targetFiles: ["src/y.ts"] },
    ]);

    const conflicts = validateAgainstClaims(plan, claimService, "plan-agent");
    assert.ok(conflicts.has("A"));
    assert.equal(conflicts.get("A")[0].heldBy, "external-agent");
    assert.ok(!conflicts.has("B"));

    store.close();
    cleanup(dir);
  });
});

// ═══ 3. OrchestratorMode ══════════════════════════════════════════

describe("OrchestratorMode", () => {
  it("empty items → serial", () => {
    const result = selectMode([]);
    assert.equal(result.mode, "serial");
  });

  it("single item → serial", () => {
    const result = selectMode([
      { id: "A", targetFiles: ["a.ts"] },
    ]);
    assert.equal(result.mode, "serial");
    assert.equal(result.maxConcurrency, 1);
  });

  it("zero conflicts → parallel", () => {
    const result = selectMode([
      { id: "A", targetFiles: ["a.ts"] },
      { id: "B", targetFiles: ["b.ts"] },
      { id: "C", targetFiles: ["c.ts"] },
    ]);
    assert.equal(result.mode, "parallel");
    assert.equal(result.maxConcurrency, 3);
  });

  it("all conflicts → serial", () => {
    const result = selectMode([
      { id: "A", targetFiles: ["shared.ts"] },
      { id: "B", targetFiles: ["shared.ts"] },
    ]);
    assert.equal(result.mode, "serial");
    assert.equal(result.maxConcurrency, 1);
  });

  it("linear chain → pipeline", () => {
    const result = selectMode([
      { id: "A", targetFiles: ["a.ts"] },
      { id: "B", targetFiles: ["b.ts"], dependsOn: ["A"] },
      { id: "C", targetFiles: ["c.ts"], dependsOn: ["B"] },
    ]);
    assert.equal(result.mode, "pipeline");
  });

  it("one root, many consumers → fan-out", () => {
    const result = selectMode([
      { id: "root", targetFiles: ["config.ts"] },
      { id: "worker-1", targetFiles: ["a.ts"], dependsOn: ["root"] },
      { id: "worker-2", targetFiles: ["b.ts"], dependsOn: ["root"] },
      { id: "worker-3", targetFiles: ["c.ts"], dependsOn: ["root"] },
    ]);
    assert.equal(result.mode, "fan-out");
    assert.equal(result.maxConcurrency, 3);
  });

  it("mixed topology → hybrid", () => {
    const result = selectMode([
      { id: "A", targetFiles: ["a.ts", "shared.ts"] },
      { id: "B", targetFiles: ["b.ts"] },
      { id: "C", targetFiles: ["c.ts", "shared.ts"] },
      { id: "D", targetFiles: ["d.ts"] },
    ]);
    assert.equal(result.mode, "hybrid");
    assert.ok(result.reasons.some(r => r.includes("conflict density")));
  });

  it("includes plan in result", () => {
    const result = selectMode([
      { id: "A", targetFiles: ["a.ts"] },
      { id: "B", targetFiles: ["b.ts"] },
    ]);
    assert.ok(result.plan);
    assert.ok(Array.isArray(result.plan.groups));
    assert.ok(Array.isArray(result.reasons));
  });
});
