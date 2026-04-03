#!/usr/bin/env node
/**
 * RAI-3: Idle Scheduler + RAI-4: Safe Job Registry
 *
 * Run: node --test tests/autonomy-scheduler.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const {
  evaluateScheduler,
  shouldAbortJob,
  defaultSchedulerConfig,
} = await import("../dist/platform/autonomy/scheduler.js");

const {
  registerJob,
  getJob,
  listJobs,
  pickJob,
  isAllowed,
  clearRegistry,
  RETRO_CONSOLIDATE,
  STATUS_BRIEF,
  DERIVED_DOC_SYNC,
  VERIFY_LIGHT,
} = await import("../dist/platform/autonomy/job-registry.js");

const NOW = Date.now();

// ═══ RAI-3: Scheduler Evaluation ══════════════════════

describe("RAI-3: evaluateScheduler — gate checks", () => {
  it("rejects when scheduler disabled", () => {
    const config = defaultSchedulerConfig();
    const result = evaluateScheduler({
      sessionState: "idle",
      pendingApprovalCount: 0,
      lastJobFinishedAt: 0,
    }, config);
    assert.equal(result.eligible, false);
    assert.ok(result.reason.includes("disabled"));
  });

  it("rejects when session is running", () => {
    const config = { ...defaultSchedulerConfig(), enabled: true };
    const result = evaluateScheduler({
      sessionState: "running",
      pendingApprovalCount: 0,
      lastJobFinishedAt: 0,
    }, config);
    assert.equal(result.eligible, false);
    assert.ok(result.reason.includes("running"));
  });

  it("rejects when session requires_action (CORE INVARIANT)", () => {
    const config = { ...defaultSchedulerConfig(), enabled: true };
    const result = evaluateScheduler({
      sessionState: "requires_action",
      pendingApprovalCount: 1,
      lastJobFinishedAt: 0,
    }, config);
    assert.equal(result.eligible, false);
    assert.ok(result.reason.includes("requires_action"));
  });

  it("rejects when pending approvals exist", () => {
    const config = { ...defaultSchedulerConfig(), enabled: true };
    const result = evaluateScheduler({
      sessionState: "idle",
      pendingApprovalCount: 2,
      lastJobFinishedAt: 0,
    }, config);
    assert.equal(result.eligible, false);
    assert.ok(result.reason.includes("pending approval"));
  });

  it("rejects during cooldown", () => {
    const config = { ...defaultSchedulerConfig(), enabled: true, cooldownMs: 60000 };
    const result = evaluateScheduler({
      sessionState: "idle",
      pendingApprovalCount: 0,
      lastJobFinishedAt: NOW - 30000, // 30s ago, cooldown is 60s
      now: NOW,
    }, config);
    assert.equal(result.eligible, false);
    assert.ok(result.reason.includes("cooldown"));
  });

  it("eligible when all gates pass", () => {
    const config = { ...defaultSchedulerConfig(), enabled: true, cooldownMs: 10000 };
    const result = evaluateScheduler({
      sessionState: "idle",
      pendingApprovalCount: 0,
      lastJobFinishedAt: NOW - 20000, // 20s ago, cooldown is 10s
      now: NOW,
    }, config);
    assert.equal(result.eligible, true);
    assert.ok(result.budget);
    assert.equal(result.budget.maxBlockingMs, 15000);
    assert.ok(result.budget.expiresAt > result.budget.startedAt);
  });

  it("eligible on first run (no previous job)", () => {
    const config = { ...defaultSchedulerConfig(), enabled: true };
    const result = evaluateScheduler({
      sessionState: "idle",
      pendingApprovalCount: 0,
      lastJobFinishedAt: 0,
      now: NOW,
    }, config);
    assert.equal(result.eligible, true);
  });
});

describe("RAI-3: shouldAbortJob", () => {
  it("aborts when budget expired", () => {
    const budget = { maxBlockingMs: 15000, startedAt: NOW - 20000, expiresAt: NOW - 5000 };
    const result = shouldAbortJob(budget, "idle", 0, NOW);
    assert.equal(result.abort, true);
    assert.ok(result.reason.includes("budget expired"));
  });

  it("aborts when session leaves idle (user return)", () => {
    const budget = { maxBlockingMs: 15000, startedAt: NOW, expiresAt: NOW + 15000 };
    const result = shouldAbortJob(budget, "running", 0, NOW + 1000);
    assert.equal(result.abort, true);
    assert.ok(result.reason.includes("running"));
  });

  it("aborts when new approval arrives", () => {
    const budget = { maxBlockingMs: 15000, startedAt: NOW, expiresAt: NOW + 15000 };
    const result = shouldAbortJob(budget, "idle", 1, NOW + 1000);
    assert.equal(result.abort, true);
    assert.ok(result.reason.includes("pending approval"));
  });

  it("continues when within budget and idle", () => {
    const budget = { maxBlockingMs: 15000, startedAt: NOW, expiresAt: NOW + 15000 };
    const result = shouldAbortJob(budget, "idle", 0, NOW + 5000);
    assert.equal(result.abort, false);
  });
});

// ═══ RAI-4: Job Registry ══════════════════════════════

describe("RAI-4: built-in safe jobs", () => {
  it("registers 4 built-in jobs", () => {
    const jobs = listJobs();
    assert.ok(jobs.length >= 4);
    assert.ok(isAllowed("retro_consolidate"));
    assert.ok(isAllowed("status_brief"));
    assert.ok(isAllowed("derived_doc_sync"));
    assert.ok(isAllowed("verify_light"));
  });

  it("none of the built-in jobs mutate source", () => {
    for (const job of listJobs()) {
      assert.equal(job.mutatesSource, false, `${job.kind} must not mutate source`);
    }
  });

  it("rejects registration of source-mutating jobs (CORE INVARIANT)", () => {
    assert.throws(() => {
      registerJob({
        kind: "dangerous_edit",
        description: "Edit source files",
        mutatesSource: true,
        requiresNetwork: false,
        estimatedMs: 1000,
        execute: async () => ({ jobId: "x", kind: "x", status: "completed", summary: "", durationMs: 0, startedAt: 0, finishedAt: 0 }),
      });
    }, /forbidden in v1 autonomy/);
  });

  it("getJob returns registered job", () => {
    const job = getJob("retro_consolidate");
    assert.ok(job);
    assert.equal(job.kind, "retro_consolidate");
    assert.equal(job.mutatesSource, false);
  });

  it("getJob returns undefined for unregistered", () => {
    assert.equal(getJob("nonexistent"), undefined);
  });

  it("isAllowed returns false for unregistered", () => {
    assert.equal(isAllowed("hack_the_planet"), false);
  });
});

describe("RAI-4: pickJob", () => {
  it("picks first eligible job within budget", () => {
    const budget = { maxBlockingMs: 15000, startedAt: NOW, expiresAt: NOW + 15000 };
    const job = pickJob(budget, { repoRoot: "/tmp" });
    assert.ok(job);
    assert.equal(job.mutatesSource, false);
  });

  it("returns null when budget too small for any job", () => {
    const budget = { maxBlockingMs: 100, startedAt: NOW, expiresAt: NOW + 100 };
    const job = pickJob(budget, { repoRoot: "/tmp" });
    assert.equal(job, null);
  });
});


// ═══ RAI-3+4: Integration ═════════════════════════════

describe("RAI-3+4: scheduler → registry pipeline", () => {
  it("full flow: evaluate → pick → execute", async () => {
    const config = { ...defaultSchedulerConfig(), enabled: true };
    const decision = evaluateScheduler({
      sessionState: "idle",
      pendingApprovalCount: 0,
      lastJobFinishedAt: 0,
      now: NOW,
    }, config);
    assert.equal(decision.eligible, true);

    // Use status_brief (guaranteed to succeed without file system deps)
    const job = getJob("status_brief");
    assert.ok(job);

    const result = await job.execute(decision.budget, { repoRoot: "/tmp", trackName: "RAI" });
    assert.equal(result.status, "completed");
  });

  it("requires_action blocks entire pipeline", () => {
    const config = { ...defaultSchedulerConfig(), enabled: true };
    const decision = evaluateScheduler({
      sessionState: "idle",
      pendingApprovalCount: 1, // Pending approval!
      lastJobFinishedAt: 0,
    }, config);
    assert.equal(decision.eligible, false);
    // No job should be picked or executed
  });
});
