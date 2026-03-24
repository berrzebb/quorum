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
  });

  it("not converged when classifications change", () => {
    storeMeetingLog(store, createMeetingLog("morning", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      [{ item: "x", classification: "build", action: "do" }], "s1"));
    storeMeetingLog(store, createMeetingLog("afternoon", "arch", { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      [{ item: "x", classification: "gap", action: "investigate" }], "s2"));

    const result = checkConvergence(store, "arch");
    assert.equal(result.converged, false);
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
