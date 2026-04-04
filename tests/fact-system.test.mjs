/**
 * Tests: Fact System (FACT WB-3 + WB-5 + WB-7)
 * extractFacts + consolidateFacts + promoteToGlobal.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { extractFacts } from "../platform/adapters/shared/fact-extractor.mjs";
import { consolidateFacts, promoteToGlobal, tokenSimilarity } from "../platform/adapters/shared/fact-consolidator.mjs";

const { EventStore } = await import("../dist/platform/bus/store.js");

// ── WB-3: Fact Extractor ────────────────────────

describe("extractFacts (WB-3)", () => {
  it("extracts audit rejection as audit_pattern", () => {
    const events = [{ type: "audit.verdict", payload: { verdict: "changes_requested", codes: ["CQ", "T"], summary: "missing tests" } }];
    const facts = extractFacts(events);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].category, "audit_pattern");
    assert.ok(facts[0].content.includes("CQ"));
  });

  it("skips approved verdicts", () => {
    const events = [{ type: "audit.verdict", payload: { verdict: "approved" } }];
    assert.equal(extractFacts(events).length, 0);
  });

  it("extracts quality.fail as error_pattern", () => {
    const events = [{ type: "quality.fail", payload: { label: "eslint", file: "app.ts", output: "no-unused-vars" } }];
    const facts = extractFacts(events);
    assert.equal(facts[0].category, "error_pattern");
    assert.ok(facts[0].content.includes("eslint"));
  });

  it("extracts specialist.review as domain_finding", () => {
    const events = [{ type: "specialist.review", payload: { verdict: "changes_requested", domain: "security", codes: ["SQL-INJ"] } }];
    const facts = extractFacts(events);
    assert.equal(facts[0].category, "domain_finding");
  });

  it("extracts fitness.gate self-correct as trigger_insight", () => {
    const events = [{ type: "fitness.gate", payload: { decision: "self-correct", delta: -0.1, reason: "test drop" } }];
    const facts = extractFacts(events);
    assert.equal(facts[0].category, "trigger_insight");
  });

  it("handles empty/null input", () => {
    assert.deepEqual(extractFacts(null), []);
    assert.deepEqual(extractFacts([]), []);
  });

  it("handles events with no payload", () => {
    assert.deepEqual(extractFacts([{ type: "audit.verdict" }]), []);
  });
});

// ── WB-5: Fact Consolidator ─────────────────────

describe("tokenSimilarity", () => {
  it("identical strings → 1.0", () => {
    assert.equal(tokenSimilarity("hello world foo", "hello world foo"), 1.0);
  });

  it("completely different → 0.0", () => {
    assert.equal(tokenSimilarity("alpha beta gamma", "delta epsilon zeta"), 0.0);
  });

  it("partial overlap → 0 < x < 1", () => {
    const s = tokenSimilarity("missing null check pattern", "missing null check error");
    assert.ok(s > 0.5);
    assert.ok(s < 1.0);
  });
});

describe("consolidateFacts (WB-5)", () => {
  let store, tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "consol-"));
    store = new EventStore({ dbPath: resolve(tmpDir, "test.db") });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges similar facts", () => {
    store.addFact({ category: "error_pattern", content: "missing null check in auth module" });
    store.addFact({ category: "error_pattern", content: "missing null check in auth module handler" });
    const result = consolidateFacts(store);
    assert.ok(result.merged >= 1);
  });

  it("promotes high-frequency candidates", () => {
    for (let i = 0; i < 3; i++) {
      store.addFact({ category: "audit_pattern", content: "always missing tests" });
    }
    const result = consolidateFacts(store);
    assert.ok(result.promoted >= 1);
    assert.equal(store.getFacts({ status: "established" }).length, 1);
  });

  it("does not promote low-frequency candidates", () => {
    store.addFact({ category: "audit_pattern", content: "rare finding" });
    const result = consolidateFacts(store);
    assert.equal(result.promoted, 0);
  });
});

// ── WB-7: Global Promotion ──────────────────────

describe("promoteToGlobal (WB-7)", () => {
  let store, tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "global-"));
    store = new EventStore({ dbPath: resolve(tmpDir, "test.db") });
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("promotes facts found in 2+ projects to global", () => {
    // Project A
    const idA = store.addFact({ category: "audit_pattern", content: "always missing tests", projectId: "proj-a" });
    store.promoteFact(idA, "established");

    // Project B — same content
    const idB = store.addFact({ category: "audit_pattern", content: "always missing tests", projectId: "proj-b" });
    store.promoteFact(idB, "established");

    const count = promoteToGlobal(store);
    assert.equal(count, 2); // both promoted to global
    const globals = store.getFacts({ scope: "global" });
    assert.equal(globals.length, 2);
  });

  it("does not promote single-project facts", () => {
    const id = store.addFact({ category: "test", content: "unique to one project", projectId: "proj-a" });
    store.promoteFact(id, "established");
    assert.equal(promoteToGlobal(store), 0);
  });
});
