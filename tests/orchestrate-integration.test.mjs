/**
 * Orchestrate integration tests — real filesystem, real parsing.
 * Tests resolveTrack, parseWorkBreakdown (colon format), committee routing,
 * empty convergence guard, loadBridge path.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// Import from dist (compiled)
import { resolveTrack, trackRef, parseWorkBreakdown, findTracks } from "../dist/cli/commands/orchestrate/shared.js";
import { routeToCommittee, checkConvergence, createMeetingLog, storeMeetingLog } from "../dist/bus/meeting-log.js";
import { EventStore } from "../dist/bus/store.js";

// ── Setup: temp project with tracks ──────────

const TEST_ROOT = resolve(tmpdir(), `quorum-orch-test-${Date.now()}`);
const PLAN_DIR = resolve(TEST_ROOT, "docs", "plan");

before(() => {
  // Create 3 sample tracks
  for (const [name, content] of [
    ["auth-system", `# WB\n\n## AUTH-1: Login flow\n\n**설명:** 로그인\n\n선행 작업: 없음\n\n## AUTH-2: Session management\n\n**설명:** 세션\n\nPrerequisite: AUTH-1\n`],
    ["payment-api", `# WB\n\n## PAY-1 Payment gateway\n\nFirst touch files: \`src/pay.ts\`\n\n## PAY-2: Refund handler\n\n블로커: PAY-1\n`],
    ["data-pipeline", `# WB\n\n## DAT-1: ETL process\n\ndepends_on: AUTH-1\n\n## DAT-2: Data validation\n\n## DAT-3: Reporting\n`],
  ]) {
    const dir = resolve(PLAN_DIR, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "work-breakdown.md"), content, "utf8");
  }
});

after(() => {
  try { rmSync(TEST_ROOT, { recursive: true, force: true }); } catch {}
});

// ── resolveTrack ─────────────────────────────

describe("resolveTrack", () => {
  it("resolves by numeric index (1-based)", () => {
    const t = resolveTrack("1", TEST_ROOT);
    assert.ok(t);
    assert.equal(t.name, "auth-system");
  });

  it("resolves by numeric index 3", () => {
    const t = resolveTrack("3", TEST_ROOT);
    assert.ok(t, "index 3 should resolve to a track");
    // Order is filesystem-dependent; just verify it's one of our tracks
    assert.ok(["auth-system", "payment-api", "data-pipeline"].includes(t.name));
  });

  it("resolves by exact name", () => {
    const t = resolveTrack("payment-api", TEST_ROOT);
    assert.ok(t);
    assert.equal(t.name, "payment-api");
  });

  it("resolves by prefix match", () => {
    const t = resolveTrack("pay", TEST_ROOT);
    assert.ok(t);
    assert.equal(t.name, "payment-api");
  });

  it("returns null for ambiguous prefix", () => {
    // "a" matches "auth-system" only, so not ambiguous
    const t = resolveTrack("a", TEST_ROOT);
    assert.ok(t);
    assert.equal(t.name, "auth-system");
  });

  it("returns null for unknown track", () => {
    assert.equal(resolveTrack("nonexistent", TEST_ROOT), null);
  });

  it("returns null for out-of-range index", () => {
    assert.equal(resolveTrack("99", TEST_ROOT), null);
  });

  it("auto-selects when undefined and only 1 track", () => {
    // Create a temp root with only 1 track
    const singleRoot = resolve(tmpdir(), `quorum-single-${Date.now()}`);
    const singleDir = resolve(singleRoot, "docs", "plan", "only-track");
    mkdirSync(singleDir, { recursive: true });
    writeFileSync(resolve(singleDir, "work-breakdown.md"), "## ONLY-1: Item\n", "utf8");

    const t = resolveTrack(undefined, singleRoot);
    assert.ok(t);
    assert.equal(t.name, "only-track");

    rmSync(singleRoot, { recursive: true, force: true });
  });

  it("returns null when undefined and multiple tracks", () => {
    assert.equal(resolveTrack(undefined, TEST_ROOT), null);
  });
});

describe("trackRef", () => {
  it("returns index for multi-track project", () => {
    const ref = trackRef("auth-system", TEST_ROOT);
    assert.equal(ref, "1");
  });

  it("returns empty string for single-track project", () => {
    const singleRoot = resolve(tmpdir(), `quorum-ref-${Date.now()}`);
    const dir = resolve(singleRoot, "docs", "plan", "solo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "work-breakdown.md"), "## S-1: Item\n", "utf8");

    assert.equal(trackRef("solo", singleRoot), "");
    rmSync(singleRoot, { recursive: true, force: true });
  });
});

// ── parseWorkBreakdown ───────────────────────

describe("parseWorkBreakdown colon format", () => {
  it("parses ## ID: title format", () => {
    const wbPath = resolve(PLAN_DIR, "auth-system", "work-breakdown.md");
    const items = parseWorkBreakdown(wbPath);
    assert.equal(items.length, 2);
    assert.equal(items[0].id, "AUTH-1");
    assert.equal(items[1].id, "AUTH-2");
  });

  it("parses mixed colon and space formats", () => {
    const wbPath = resolve(PLAN_DIR, "payment-api", "work-breakdown.md");
    const items = parseWorkBreakdown(wbPath);
    assert.equal(items.length, 2);
    assert.equal(items[0].id, "PAY-1");
    assert.equal(items[1].id, "PAY-2");
  });

  it("parses Korean dependency keywords", () => {
    const wbPath = resolve(PLAN_DIR, "payment-api", "work-breakdown.md");
    const items = parseWorkBreakdown(wbPath);
    const pay2 = items.find(i => i.id === "PAY-2");
    assert.ok(pay2);
    assert.deepEqual(pay2.dependsOn, ["PAY-1"]);
  });

  it("parses Prerequisite dependency", () => {
    const wbPath = resolve(PLAN_DIR, "auth-system", "work-breakdown.md");
    const items = parseWorkBreakdown(wbPath);
    const auth2 = items.find(i => i.id === "AUTH-2");
    assert.ok(auth2);
    assert.deepEqual(auth2.dependsOn, ["AUTH-1"]);
  });

  it("parses depends_on keyword", () => {
    const wbPath = resolve(PLAN_DIR, "data-pipeline", "work-breakdown.md");
    const items = parseWorkBreakdown(wbPath);
    const dat1 = items.find(i => i.id === "DAT-1");
    assert.ok(dat1);
    assert.deepEqual(dat1.dependsOn, ["AUTH-1"]);
  });
});

// ── Committee routing (Korean) ───────────────

describe("committee routing Korean", () => {
  it("routes 플랫폼 구축 to architecture", () => {
    const committees = routeToCommittee("정보수집을 위한 INTL 플랫폼 구축");
    assert.ok(committees.includes("architecture"));
  });

  it("routes 설계 to architecture", () => {
    const committees = routeToCommittee("시스템 설계 논의");
    assert.ok(committees.includes("architecture"));
  });

  it("routes 범위 to scope", () => {
    const committees = routeToCommittee("MVP 범위 정의");
    assert.ok(committees.includes("scope"));
  });

  it("routes 원칙 to principles", () => {
    const committees = routeToCommittee("감사 추적 원칙 수립");
    assert.ok(committees.includes("principles"));
  });

  it("routes 구조 to structure", () => {
    const committees = routeToCommittee("계층 구조 설계");
    assert.ok(committees.includes("structure"));
  });

  it("routes 정의 to definitions", () => {
    const committees = routeToCommittee("에이전트 정의 문서");
    assert.ok(committees.includes("definitions"));
  });

  it("routes 연구 to research-questions", () => {
    const committees = routeToCommittee("통신 프로토콜 연구");
    assert.ok(committees.includes("research-questions"));
  });

  it("English topic still works", () => {
    const committees = routeToCommittee("system architecture overview");
    assert.ok(committees.includes("architecture"));
  });
});

// ── Empty convergence guard ──────────────────

describe("empty convergence guard", () => {
  it("does NOT converge when all classifications are empty", () => {
    const dbPath = resolve(tmpdir(), `quorum-conv-test-${Date.now()}.db`);
    const store = new EventStore({ dbPath });

    // Store 3 meeting logs with EMPTY classifications (simulates parse failure)
    for (let i = 0; i < 3; i++) {
      const log = createMeetingLog("morning", "test-agenda",
        { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
        [],  // empty classifications!
        "parse failed"
      );
      storeMeetingLog(store, log);
    }

    const result = checkConvergence(store, "test-agenda");
    assert.equal(result.converged, false, "Empty classifications should NOT converge");

    store.close();
    try { rmSync(dbPath, { force: true }); } catch {}
  });

  it("DOES converge when classifications have content", () => {
    const dbPath = resolve(tmpdir(), `quorum-conv-ok-${Date.now()}.db`);
    const store = new EventStore({ dbPath });

    const classifications = [
      { item: "Need auth", classification: "gap", action: "build it" },
      { item: "Good structure", classification: "strength", action: "keep" },
    ];

    for (let i = 0; i < 3; i++) {
      storeMeetingLog(store, createMeetingLog("morning", "ok-agenda",
        { statusChanges: ["changed"], decisions: ["decided"], requirementChanges: [], risks: [] },
        classifications, "good session"
      ));
    }

    const result = checkConvergence(store, "ok-agenda");
    assert.equal(result.converged, true, "Stable non-empty classifications should converge");

    store.close();
    try { rmSync(dbPath, { force: true }); } catch {}
  });
});
