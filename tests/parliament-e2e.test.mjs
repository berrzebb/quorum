#!/usr/bin/env node
/**
 * Parliament E2E Pipeline Test
 *
 * Tests the full parliamentary protocol pipeline:
 * hook trigger → bridge → session → meeting log → convergence → CPS →
 * amendment → confluence → normal form
 *
 * Run: node --test tests/parliament-e2e.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { EventStore } = await import("../dist/bus/store.js");
const {
  createMeetingLog,
  storeMeetingLog,
  getMeetingLogs,
  checkConvergence,
  generateCPS,
  routeToCommittee,
  STANDING_COMMITTEES,
} = await import("../dist/bus/meeting-log.js");
const {
  proposeAmendment,
  voteOnAmendment,
  resolveAmendment,
  getAmendments,
} = await import("../dist/bus/amendment.js");
const { verifyConfluence } = await import("../dist/bus/confluence.js");
const {
  classifyStage,
  computeConformance,
  trackProviderConvergence,
  generateConvergenceReport,
} = await import("../dist/bus/normal-form.js");

/** Fresh in-memory store. */
function createStore() {
  return new EventStore({ dbPath: ":memory:" });
}

/** Helper: standard classifications for a session. */
function makeClassifications() {
  return [
    { item: "Auth module", classification: "build", action: "implement JWT handler" },
    { item: "Legacy API", classification: "out", action: "remove from scope" },
    { item: "Missing rate limit", classification: "gap", action: "add rate limiter" },
    { item: "DB abstraction", classification: "strength", action: "keep pattern" },
    { item: "Redis cache", classification: "buy", action: "use existing lib" },
  ];
}

/** Helper: standard registers. */
function makeRegisters() {
  return {
    statusChanges: ["Auth module under review"],
    decisions: ["Use JWT for auth", "PostgreSQL as primary DB"],
    requirementChanges: ["Add rate limiting to API"],
    risks: ["Token expiry edge case"],
  };
}

// ═══ 1. Full Pipeline: Meeting → Convergence → CPS ═══════════════

describe("E2E: Meeting accumulation → Convergence → CPS", () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it("accumulates logs, detects convergence, generates CPS", () => {
    const cls = makeClassifications();
    const regs = makeRegisters();

    // Session 1: initial divergence
    const log1 = createMeetingLog("morning", "architecture", regs, cls, "First session");
    storeMeetingLog(store, log1);

    // Not converged after 1 session
    const status1 = checkConvergence(store, "architecture");
    assert.equal(status1.converged, false);
    assert.equal(status1.stableRounds, 0);

    // Session 2: same classifications → 1 stable round
    const log2 = createMeetingLog("afternoon", "architecture", regs, cls, "Second session — stable");
    storeMeetingLog(store, log2);

    const status2 = checkConvergence(store, "architecture");
    assert.equal(status2.stableRounds, 1);

    // Session 3: same classifications → 2 stable rounds → converged
    const log3 = createMeetingLog("morning", "architecture", regs, cls, "Third session — converged");
    storeMeetingLog(store, log3);

    const status3 = checkConvergence(store, "architecture");
    assert.equal(status3.converged, true);
    assert.ok(status3.stableRounds >= 2);

    // Generate CPS from converged logs
    const logs = getMeetingLogs(store, "architecture");
    const cps = generateCPS(logs);

    assert.ok(cps.context.length > 0, "CPS should have context");
    assert.ok(cps.problem.length > 0, "CPS should have problem");
    assert.ok(cps.solution.length > 0, "CPS should have solution");
    assert.equal(cps.gaps.length, 3, "3 logs × 1 gap each = 3 gap items");
    assert.equal(cps.builds.length, 3, "3 logs × 1 build each = 3 build items");
    assert.equal(cps.sourceLogIds.length, 3);
  });
});

// ═══ 2. Full Pipeline: Amendment lifecycle ═══════════════════════

describe("E2E: Amendment propose → vote → resolve", () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it("runs full amendment lifecycle with majority voting", () => {
    // Propose
    const amendment = proposeAmendment(
      store, "architecture", "Add caching layer",
      "advocate-1", "advocate", "Reduces latency",
    );
    assert.equal(amendment.status, "proposed");

    // Vote: 3 voters, 2 for → majority (VotePosition: "for"/"against"/"abstain")
    const v1 = voteOnAmendment(store, amendment.id, "advocate-1", "advocate", "for", 0.9);
    assert.ok(v1.success);

    const v2 = voteOnAmendment(store, amendment.id, "devil-1", "devil", "against", 0.7);
    assert.ok(v2.success);

    const v3 = voteOnAmendment(store, amendment.id, "judge-1", "judge", "for", 0.85);
    assert.ok(v3.success);

    // Resolve: 2 for / 1 against with 3 eligible → quorum met, approved
    const resolution = resolveAmendment(store, amendment.id, 3);
    assert.equal(resolution.status, "approved");
    assert.ok(resolution.votesFor >= 2);

    // Implementer cannot vote
    const implVote = voteOnAmendment(store, amendment.id, "impl-1", "implementer", "for", 1.0);
    assert.equal(implVote.success, false);
    assert.ok(implVote.reason.includes("implementer"));
  });
});

// ═══ 3. Confluence Verification ══════════════════════════════════

describe("E2E: Confluence 4-check verification", () => {
  it("passes when all checks are green", () => {
    const result = verifyConfluence({
      auditVerdict: "approved",
      integrationTestsPassed: true,
      cpsGapsResolved: true,
      amendmentContradictions: [],
    });

    assert.equal(result.passed, true);
    assert.equal(result.checks.length, 4);
    assert.ok(result.checks.every(c => c.passed));
    assert.equal(result.suggestedAmendments.length, 0);
  });

  it("fails and suggests amendments on mismatches", () => {
    const result = verifyConfluence({
      auditVerdict: "changes_requested",
      integrationTestsPassed: false,
      cpsGapsResolved: false,
      amendmentContradictions: [{ law1: "A", law2: "B", description: "conflict" }],
    });

    assert.equal(result.passed, false);
    assert.ok(result.checks.some(c => !c.passed));
    assert.ok(result.suggestedAmendments.length > 0);
  });
});

// ═══ 4. Normal Form Convergence ══════════════════════════════════

describe("E2E: Normal Form stage classification + conformance", () => {
  it("classifies stages correctly across audit progression", () => {
    // No audit → raw-output
    assert.equal(classifyStage(0, null, false), "raw-output");

    // 1 round, changes_requested → autofix
    assert.equal(classifyStage(1, "changes_requested", false), "autofix");

    // 2 rounds, approved, no confluence → autofix (≤2 rounds = autofix)
    assert.equal(classifyStage(2, "approved", false), "autofix");

    // 3+ rounds, approved, no confluence → manual-fix
    assert.equal(classifyStage(3, "approved", false), "manual-fix");

    // 1 round, approved, confluence passed → normal-form
    assert.equal(classifyStage(1, "approved", true), "normal-form");
  });

  it("computes conformance score from 3 inputs (returns percentage 0-100)", () => {
    // Perfect scores: 0.95*0.4 + 1.0*0.4 + 1.0*0.2 = 0.98 → 98%
    const perfect = computeConformance(0.95, 1.0, 1.0);
    assert.ok(perfect > 90, `Expected >90, got ${perfect}`);

    // Zero scores
    const zero = computeConformance(0, 0, 0);
    assert.equal(zero, 0);

    // Mixed: 0.5*0.4 + 0.5*0.4 + 0.5*0.2 = 0.5 → 50%
    const mixed = computeConformance(0.5, 0.5, 0.5);
    assert.ok(mixed >= 49 && mixed <= 51, `Expected ~50, got ${mixed}`);
  });
});

// ═══ 5. Committee Routing ════════════════════════════════════════

describe("E2E: Standing committee routing", () => {
  it("routes topics to correct committees", () => {
    assert.deepEqual(routeToCommittee("I/O boundary validation"), ["principles"]);
    // "protocol" matches architecture pattern
    assert.deepEqual(routeToCommittee("system architecture overview"), ["architecture"]);
    assert.deepEqual(routeToCommittee("what is in scope for MVP"), ["scope"]);
    // "communicat" matches research-questions
    assert.deepEqual(routeToCommittee("inter-agent communication design"), ["research-questions"]);
  });

  it("routes unmatched topics to research-questions", () => {
    assert.deepEqual(routeToCommittee("completely unrelated topic xyz"), ["research-questions"]);
  });

  it("routes multi-concern topics to multiple committees", () => {
    const result = routeToCommittee("audit trail for agent hierarchical calls");
    assert.ok(result.length >= 1);
  });
});

// ═══ 6. Cross-Committee Convergence Independence ═════════════════

describe("E2E: Cross-committee convergence independence", () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it("tracks convergence independently per committee", () => {
    const cls = makeClassifications();
    const regs = makeRegisters();

    // Architecture: 3 identical sessions → converged
    for (let i = 0; i < 3; i++) {
      storeMeetingLog(store, createMeetingLog("morning", "architecture", regs, cls, `arch-${i}`));
    }

    // Principles: 1 session → not converged
    storeMeetingLog(store, createMeetingLog("morning", "principles", regs, cls, "p-0"));

    const archStatus = checkConvergence(store, "architecture");
    const prinStatus = checkConvergence(store, "principles");

    assert.equal(archStatus.converged, true);
    assert.equal(prinStatus.converged, false);
  });
});

// ═══ 7. Integrated Pipeline: Session → Amendment → Confluence ════

describe("E2E: Full integrated pipeline", () => {
  let store;
  beforeEach(() => { store = createStore(); });

  it("runs meeting → convergence → CPS → amendment → confluence → normal form", () => {
    const cls = makeClassifications();
    const regs = makeRegisters();

    // Phase 1: Accumulate meeting logs to convergence
    for (let i = 0; i < 3; i++) {
      storeMeetingLog(store, createMeetingLog(
        i % 2 === 0 ? "morning" : "afternoon",
        "architecture", regs, cls, `Session ${i + 1}`,
      ));
    }
    const convergence = checkConvergence(store, "architecture");
    assert.equal(convergence.converged, true, "Should converge after 3 stable sessions");

    // Phase 2: Generate CPS
    const logs = getMeetingLogs(store, "architecture");
    const cps = generateCPS(logs);
    assert.ok(cps.gaps.length > 0, "CPS should identify gaps");
    assert.ok(cps.builds.length > 0, "CPS should identify builds");

    // Phase 3: Propose amendment (gap discovered during session)
    const amendment = proposeAmendment(
      store, "architecture", "Add rate limiting middleware",
      "devil-1", "devil", "Gap identified: missing rate limit",
    );

    // Vote and resolve (VotePosition: "for"/"against"/"abstain")
    voteOnAmendment(store, amendment.id, "advocate-1", "advocate", "for", 0.8);
    voteOnAmendment(store, amendment.id, "devil-1", "devil", "for", 0.9);
    voteOnAmendment(store, amendment.id, "judge-1", "judge", "for", 0.85);
    const resolution = resolveAmendment(store, amendment.id, 3);
    assert.equal(resolution.status, "approved");

    // Phase 4: Confluence verification
    const confluenceResult = verifyConfluence({
      auditVerdict: "approved",
      integrationTestsPassed: true,
      cpsGapsResolved: true,
      amendmentContradictions: [],
    });
    assert.equal(confluenceResult.passed, true);

    // Phase 5: Normal Form classification
    const stage = classifyStage(1, "approved", true);
    assert.equal(stage, "normal-form");

    // computeConformance returns percentage (0-100)
    const conformance = computeConformance(0.85, 1.0, 1.0);
    assert.ok(conformance > 80, `Expected >80%, got ${conformance}`);

    // Verify all events are in store (QuorumEvent uses .type, not .eventType)
    const allEvents = store.query({});
    const parliamentEvents = allEvents.filter(e => e.type?.startsWith("parliament."));
    assert.ok(parliamentEvents.length >= 6, `Expected ≥6 parliament events, got ${parliamentEvents.length}`);
  });
});

// ═══ 8. 6 Standing Committees exist ══════════════════════════════

describe("E2E: Standing committees configuration", () => {
  it("has exactly 6 standing committees", () => {
    const committees = Object.keys(STANDING_COMMITTEES);
    assert.equal(committees.length, 6);
    assert.ok(committees.includes("principles"));
    assert.ok(committees.includes("definitions"));
    assert.ok(committees.includes("structure"));
    assert.ok(committees.includes("architecture"));
    assert.ok(committees.includes("scope"));
    assert.ok(committees.includes("research-questions"));
  });

  it("each committee has name and items", () => {
    for (const [key, val] of Object.entries(STANDING_COMMITTEES)) {
      assert.ok(val.name, `${key} should have a name`);
      assert.ok(Array.isArray(val.items), `${key} should have items array`);
      assert.ok(val.items.length > 0, `${key} should have at least 1 item`);
    }
  });
});
