import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createMeetingLog,
  storeMeetingLog,
  getMeetingLogs,
  checkConvergence,
  generateCPS,
  STANDING_COMMITTEES,
} from "../dist/bus/meeting-log.js";
import { EventStore } from "../dist/bus/store.js";

// ═══ 1. createMeetingLog ═══════════════════════════════

describe("createMeetingLog", () => {
  it("creates a well-formed meeting log", () => {
    const log = createMeetingLog("morning", "principles", {
      statusChanges: ["auth module reviewed"],
      decisions: ["use JWT"],
      requirementChanges: [],
      risks: ["token expiry handling"],
    }, [
      { item: "JWT implementation", classification: "build", action: "implement in auth module" },
      { item: "SMS notification", classification: "out", action: "remove from scope" },
    ], "Session focused on auth design");

    assert.ok(log.id);
    assert.equal(log.sessionType, "morning");
    assert.equal(log.agendaId, "principles");
    assert.equal(log.registers.decisions.length, 1);
    assert.equal(log.classifications.length, 2);
    assert.ok(log.convergenceScore >= 0 && log.convergenceScore <= 1);
    assert.ok(log.timestamp > 0);
  });
});

// ═══ 2. Store + Retrieve ═══════════════════════════════

describe("storeMeetingLog + getMeetingLogs", () => {
  let store;
  beforeEach(() => { store = new EventStore({ dbPath: ":memory:" }); });

  it("round-trips a meeting log through EventStore", () => {
    const log = createMeetingLog("afternoon", "definitions", {
      statusChanges: [], decisions: ["Agent = autonomous unit"], requirementChanges: [], risks: [],
    }, [
      { item: "Agent definition", classification: "strength", action: "keep as pattern" },
    ], "Defined agent terminology");

    storeMeetingLog(store, log);
    const retrieved = getMeetingLogs(store, "definitions");

    assert.equal(retrieved.length, 1);
    assert.equal(retrieved[0].agendaId, "definitions");
    assert.equal(retrieved[0].sessionType, "afternoon");
    assert.equal(retrieved[0].classifications.length, 1);
  });

  it("filters by agendaId", () => {
    storeMeetingLog(store, createMeetingLog("morning", "principles", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] }, [], "p1"));
    storeMeetingLog(store, createMeetingLog("morning", "scope", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] }, [], "s1"));

    assert.equal(getMeetingLogs(store, "principles").length, 1);
    assert.equal(getMeetingLogs(store, "scope").length, 1);
    assert.equal(getMeetingLogs(store).length, 2); // all
  });
});

// ═══ 3. Convergence Detection ══════════════════════════

describe("checkConvergence", () => {
  let store;
  beforeEach(() => { store = new EventStore({ dbPath: ":memory:" }); });

  it("not converged with fewer than 2 logs", () => {
    storeMeetingLog(store, createMeetingLog("morning", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      [{ item: "x", classification: "build", action: "do" }], "first"));

    const result = checkConvergence(store, "arch");
    assert.equal(result.converged, false);
  });

  it("converges when 2 consecutive sessions have identical classifications", () => {
    const items = [
      { item: "API server", classification: /** @type {const} */ ("build"), action: "implement" },
      { item: "SMS", classification: /** @type {const} */ ("out"), action: "exclude" },
    ];

    storeMeetingLog(store, createMeetingLog("morning", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] }, items, "s1"));
    storeMeetingLog(store, createMeetingLog("afternoon", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] }, items, "s2"));
    storeMeetingLog(store, createMeetingLog("morning", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] }, items, "s3"));

    const result = checkConvergence(store, "arch");
    assert.equal(result.converged, true);
    assert.ok(result.stableRounds >= 2);
    assert.equal(result.convergencePath, "exact");
  });

  it("not converged when classifications change", () => {
    storeMeetingLog(store, createMeetingLog("morning", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      [{ item: "x", classification: "build", action: "do" }], "s1"));
    storeMeetingLog(store, createMeetingLog("afternoon", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      [{ item: "x", classification: "gap", action: "investigate" }], "s2"));

    const result = checkConvergence(store, "arch");
    assert.equal(result.converged, false);
    assert.equal(result.convergencePath, null);
  });

  it("converges via no-new-items path when item set stabilizes but classifications shift", () => {
    // Greenfield scenario: same items, different classifications across rounds
    const regs = { statusChanges: [], decisions: [], requirementChanges: [], risks: [] };

    // Round 1: 3 items — all build
    storeMeetingLog(store, createMeetingLog("morning", "arch", regs, [
      { item: "Dashboard UI", classification: "build", action: "create React app" },
      { item: "Data API", classification: "build", action: "implement REST endpoints" },
      { item: "Auth module", classification: "gap", action: "need design" },
    ], "r1"));

    // Round 2: same 3 items, reclassified (gap→build)
    storeMeetingLog(store, createMeetingLog("afternoon", "arch", regs, [
      { item: "Dashboard UI", classification: "build", action: "create Next.js app" },
      { item: "Data API", classification: "build", action: "implement GraphQL" },
      { item: "Auth module", classification: "build", action: "use NextAuth" },
    ], "r2"));

    // Round 3: same 3 items, minor refinements
    storeMeetingLog(store, createMeetingLog("morning", "arch", regs, [
      { item: "Dashboard UI", classification: "build", action: "create Next.js app with Tailwind" },
      { item: "Data API", classification: "build", action: "implement GraphQL" },
      { item: "Auth module", classification: "build", action: "use NextAuth" },
    ], "r3"));

    const result = checkConvergence(store, "arch");
    assert.equal(result.converged, true);
    assert.equal(result.convergencePath, "no-new-items");
    assert.ok(result.noNewItemsRounds >= 2);
  });

  it("no-new-items resets when a new item appears", () => {
    const regs = { statusChanges: [], decisions: [], requirementChanges: [], risks: [] };
    const agenda = "reset-test";
    const base = Date.now();

    const l1 = createMeetingLog("morning", agenda, regs, [
      { item: "API", classification: "build", action: "implement" },
    ], "r1");
    l1.timestamp = base;
    storeMeetingLog(store, l1);

    const l2 = createMeetingLog("afternoon", agenda, regs, [
      { item: "API", classification: "gap", action: "redesign" },
    ], "r2");
    l2.timestamp = base + 1000;
    storeMeetingLog(store, l2);

    // Round 3: NEW item added — resets no-new-items
    const l3 = createMeetingLog("morning", agenda, regs, [
      { item: "API", classification: "build", action: "implement" },
      { item: "Database", classification: "build", action: "add PostgreSQL" },
    ], "r3");
    l3.timestamp = base + 2000;
    storeMeetingLog(store, l3);

    const result = checkConvergence(store, agenda);
    assert.equal(result.noNewItemsRounds, 0);
  });

  it("converges via relaxed path when delta is within 20% of item count", () => {
    const regs = { statusChanges: [], decisions: [], requirementChanges: [], risks: [] };
    const agenda = "relaxed-test";
    const base = Date.now();

    // Round 1: 10 items — items are DIFFERENT across rounds to avoid no-new-items path
    const l1 = createMeetingLog("morning", agenda, regs, [
      { item: "Auth module v1", classification: "build", action: "do" },
      { item: "API server v1", classification: "build", action: "do" },
      { item: "DB layer v1", classification: "build", action: "do" },
      { item: "Cache v1", classification: "build", action: "do" },
      { item: "Logger v1", classification: "build", action: "do" },
      { item: "Router v1", classification: "build", action: "do" },
      { item: "Security audit v1", classification: "gap", action: "investigate" },
      { item: "Performance review v1", classification: "gap", action: "investigate" },
      { item: "CDN integration v1", classification: "buy", action: "purchase" },
      { item: "Legacy system v1", classification: "out", action: "exclude" },
    ], "r1");
    l1.timestamp = base;
    storeMeetingLog(store, l1);

    // Round 2: DIFFERENT item names (rephrased), 1 classification shift — delta=2, tolerance=max(2,10*0.2)=2
    const l2 = createMeetingLog("afternoon", agenda, regs, [
      { item: "Authentication v2", classification: "build", action: "do" },
      { item: "REST API v2", classification: "build", action: "do" },
      { item: "Database v2", classification: "build", action: "do" },
      { item: "Caching v2", classification: "build", action: "do" },
      { item: "Logging v2", classification: "build", action: "do" },
      { item: "Routing v2", classification: "build", action: "do" },
      { item: "Security v2", classification: "build", action: "resolved" },
      { item: "Performance v2", classification: "gap", action: "investigate" },
      { item: "CDN v2", classification: "buy", action: "purchase" },
      { item: "Legacy v2", classification: "out", action: "exclude" },
    ], "r2");
    l2.timestamp = base + 1000;
    storeMeetingLog(store, l2);

    // Round 3: DIFFERENT names again, another small shift — delta=2 (within tolerance)
    const l3 = createMeetingLog("morning", agenda, regs, [
      { item: "Auth v3", classification: "build", action: "do" },
      { item: "API v3", classification: "build", action: "do" },
      { item: "DB v3", classification: "build", action: "do" },
      { item: "Cache v3", classification: "build", action: "do" },
      { item: "Log v3", classification: "build", action: "do" },
      { item: "Route v3", classification: "build", action: "do" },
      { item: "Security v3", classification: "build", action: "resolved" },
      { item: "Perf v3", classification: "build", action: "resolved" },
      { item: "CDN v3", classification: "buy", action: "purchase" },
      { item: "Legacy v3", classification: "out", action: "exclude" },
    ], "r3");
    l3.timestamp = base + 2000;
    storeMeetingLog(store, l3);

    const result = checkConvergence(store, agenda);
    assert.equal(result.converged, true);
    assert.equal(result.convergencePath, "relaxed");
    assert.ok(result.relaxedRounds >= 2);
    assert.equal(result.noNewItemsRounds, 0);
  });

  it("relaxed path rejects delta beyond tolerance", () => {
    const regs = { statusChanges: [], decisions: [], requirementChanges: [], risks: [] };
    const agenda = "relaxed-reject";

    // Round 1: 5 items — tolerance = max(2, floor(5*0.2)) = 2
    storeMeetingLog(store, createMeetingLog("morning", agenda, regs, [
      { item: "A", classification: "build", action: "do" },
      { item: "B", classification: "build", action: "do" },
      { item: "C", classification: "build", action: "do" },
      { item: "D", classification: "gap", action: "do" },
      { item: "E", classification: "gap", action: "do" },
    ], "r1"));

    // Round 2: large shift — delta=4 (build:3→1, gap:2→4), tolerance=2 → exceeds
    storeMeetingLog(store, createMeetingLog("afternoon", agenda, regs, [
      { item: "A", classification: "build", action: "do" },
      { item: "B", classification: "gap", action: "do" },
      { item: "C", classification: "gap", action: "do" },
      { item: "D", classification: "gap", action: "do" },
      { item: "E", classification: "gap", action: "do" },
    ], "r2"));

    const result = checkConvergence(store, agenda);
    // delta = |1-3| + |4-2| = 2+2 = 4 > tolerance(2)
    assert.equal(result.relaxedRounds, 0);
    assert.equal(result.converged, false);
  });

  it("filters noise logs from parse-fallback (item count drop >50%)", () => {
    const regs = { statusChanges: [], decisions: [], requirementChanges: [], risks: [] };
    const agenda = "noise-filter";
    const base = Date.now();
    const items10 = Array.from({ length: 10 }, (_, i) => ({ item: `Item${i}`, classification: /** @type {const} */ ("build"), action: "do" }));
    const items10b = Array.from({ length: 10 }, (_, i) => ({ item: `Thing${i}`, classification: /** @type {const} */ ("build"), action: "do" }));

    // Round 1: 10 items
    const l1 = createMeetingLog("morning", agenda, regs, items10, "r1");
    l1.timestamp = base;
    storeMeetingLog(store, l1);

    // Round 2: 3 items (parse-fallback noise — >50% drop from 10)
    const l2 = createMeetingLog("afternoon", agenda, regs, [
      { item: "X", classification: "gap", action: "do" },
      { item: "Y", classification: "gap", action: "do" },
      { item: "Z", classification: "gap", action: "do" },
    ], "r2-noise");
    l2.timestamp = base + 1000;
    storeMeetingLog(store, l2);

    // Round 3: 10 items again (back to normal, same distribution as R1)
    const l3 = createMeetingLog("morning", agenda, regs, items10b, "r3");
    l3.timestamp = base + 2000;
    storeMeetingLog(store, l3);

    const result = checkConvergence(store, agenda);
    // Noise log (R2) should be filtered. R1 vs R3 compared directly.
    // Both have 10 build items → exact match → stableRounds=1
    // With 3 logs but noise filtered, effective 2 logs → stableRounds can be 1
    assert.ok(result.stableRounds >= 1 || result.relaxedRounds >= 1, "Should count stable after noise filter");
  });

  it("returns all convergence fields including relaxedRounds", () => {
    const result = checkConvergence(store, "nonexistent");
    assert.equal(typeof result.noNewItemsRounds, "number");
    assert.equal(typeof result.relaxedRounds, "number");
    assert.equal(result.convergencePath, null);
  });
});

// ═══ 4. CPS Generation ═════════════════════════════════

describe("generateCPS", () => {
  it("includes only Gap + Build items", () => {
    const logs = [
      createMeetingLog("morning", "scope", { statusChanges: ["reviewed"], decisions: ["use REST"], requirementChanges: [], risks: ["latency"] }, [
        { item: "auth module", classification: "build", action: "implement" },
        { item: "old logging", classification: "out", action: "remove" },
        { item: "error handling", classification: "gap", action: "add WB" },
        { item: "API design", classification: "strength", action: "keep" },
        { item: "payment", classification: "buy", action: "use Stripe" },
      ], "scope review"),
    ];

    const cps = generateCPS(logs);

    assert.equal(cps.gaps.length, 1);
    assert.equal(cps.gaps[0].item, "error handling");
    assert.equal(cps.builds.length, 1);
    assert.equal(cps.builds[0].item, "auth module");
    assert.ok(cps.context.includes("reviewed"));
    assert.ok(cps.problem.includes("error handling"));
    assert.ok(cps.solution.includes("auth module"));
    assert.equal(cps.sourceLogIds.length, 1);
  });

  it("aggregates across multiple logs", () => {
    const logs = [
      createMeetingLog("morning", "a", { statusChanges: [], decisions: ["d1"], requirementChanges: [], risks: [] },
        [{ item: "x", classification: "gap", action: "fix" }], "log1"),
      createMeetingLog("afternoon", "a", { statusChanges: [], decisions: ["d2"], requirementChanges: [], risks: [] },
        [{ item: "y", classification: "build", action: "make" }], "log2"),
    ];

    const cps = generateCPS(logs);
    assert.equal(cps.gaps.length, 1);
    assert.equal(cps.builds.length, 1);
    assert.equal(cps.sourceLogIds.length, 2);
  });
});

// ═══ 5. Standing Committees ════════════════════════════

describe("STANDING_COMMITTEES", () => {
  it("has exactly 6 committees", () => {
    assert.equal(Object.keys(STANDING_COMMITTEES).length, 6);
  });

  it("each committee has name and items", () => {
    for (const [key, value] of Object.entries(STANDING_COMMITTEES)) {
      assert.ok(value.name, `${key} missing name`);
      assert.ok(Array.isArray(value.items), `${key} missing items`);
      assert.ok(value.items.length > 0, `${key} has no items`);
    }
  });
});
