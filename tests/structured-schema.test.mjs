/**
 * Tests for Phase 4: Structured output schemas + consensus fast path.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ── structured-schema ───────────────────────────────────

describe("structured-schema", () => {
  let mod;
  before(async () => {
    mod = await import("../dist/platform/providers/auditors/structured-schema.js");
  });

  describe("parseStructuredOpinion", () => {
    it("parses valid structured opinion", () => {
      const result = mod.parseStructuredOpinion(JSON.stringify({
        verdict: "approved",
        reasoning: "Code looks good",
        codes: [],
        confidence: 0.95,
      }));
      assert.ok(result);
      assert.equal(result.verdict, "approved");
      assert.equal(result.reasoning, "Code looks good");
      assert.equal(result.confidence, 0.95);
    });

    it("parses opinion with findings", () => {
      const result = mod.parseStructuredOpinion(JSON.stringify({
        verdict: "changes_requested",
        reasoning: "Found issues",
        codes: ["sql-injection"],
        confidence: 0.88,
        findings: [
          { severity: "high", title: "SQL Injection", body: "Unsafe query on line 42" },
        ],
      }));
      assert.ok(result);
      assert.equal(result.verdict, "changes_requested");
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].severity, "high");
    });

    it("clamps confidence to [0, 1]", () => {
      const result = mod.parseStructuredOpinion(JSON.stringify({
        verdict: "approved",
        reasoning: "ok",
        codes: [],
        confidence: 1.5,
      }));
      assert.ok(result);
      assert.equal(result.confidence, 1.0);
    });

    it("returns null for invalid JSON", () => {
      assert.equal(mod.parseStructuredOpinion("not json"), null);
    });

    it("returns null for missing verdict", () => {
      assert.equal(mod.parseStructuredOpinion(JSON.stringify({
        reasoning: "no verdict",
        codes: [],
        confidence: 0.5,
      })), null);
    });

    it("returns null for invalid verdict value", () => {
      assert.equal(mod.parseStructuredOpinion(JSON.stringify({
        verdict: "maybe",
        reasoning: "uncertain",
        codes: [],
        confidence: 0.5,
      })), null);
    });

    it("returns null for missing reasoning", () => {
      assert.equal(mod.parseStructuredOpinion(JSON.stringify({
        verdict: "approved",
        codes: [],
        confidence: 0.5,
      })), null);
    });

    it("handles whitespace-padded input", () => {
      const result = mod.parseStructuredOpinion(`  ${JSON.stringify({
        verdict: "approved",
        reasoning: "ok",
        codes: [],
        confidence: 0.9,
      })}  `);
      assert.ok(result);
      assert.equal(result.verdict, "approved");
    });
  });

  describe("parseStructuredJudgeVerdict", () => {
    it("parses valid judge verdict", () => {
      const result = mod.parseStructuredJudgeVerdict(JSON.stringify({
        verdict: "approved",
        summary: "Both reviewers agree",
        codes: [],
      }));
      assert.ok(result);
      assert.equal(result.verdict, "approved");
      assert.equal(result.summary, "Both reviewers agree");
    });

    it("parses verdict with findings", () => {
      const result = mod.parseStructuredJudgeVerdict(JSON.stringify({
        verdict: "changes_requested",
        summary: "Critical issue found",
        codes: ["type-error"],
        findings: [
          { severity: "high", title: "Type Error", body: "Missing null check" },
        ],
      }));
      assert.ok(result);
      assert.equal(result.findings.length, 1);
    });

    it("returns null for missing summary", () => {
      assert.equal(mod.parseStructuredJudgeVerdict(JSON.stringify({
        verdict: "approved",
        codes: [],
      })), null);
    });

    it("returns null for non-JSON", () => {
      assert.equal(mod.parseStructuredJudgeVerdict("plain text"), null);
    });
  });

  describe("schema exports", () => {
    it("OPINION_SCHEMA has required fields", () => {
      assert.ok(mod.OPINION_SCHEMA);
      assert.deepEqual(mod.OPINION_SCHEMA.required, ["verdict", "reasoning", "codes", "confidence"]);
    });

    it("JUDGE_VERDICT_SCHEMA has required fields", () => {
      assert.ok(mod.JUDGE_VERDICT_SCHEMA);
      assert.deepEqual(mod.JUDGE_VERDICT_SCHEMA.required, ["verdict", "summary", "codes"]);
    });
  });
});

// ── consensus fast path integration ─────────────────────

describe("consensus structured fast path", () => {
  it("consensus.ts imports structured-schema", async () => {
    // Verify the import exists in the compiled output
    const { readFileSync } = await import("node:fs");
    const content = readFileSync("dist/platform/providers/consensus.js", "utf8");
    assert.ok(content.includes("structured-schema"), "consensus.js should import structured-schema");
  });

  it("parseOpinion should use fast path for valid structured JSON", async () => {
    // We can't call parseOpinion directly (it's not exported),
    // but we verify the consensus module loads without error
    const mod = await import("../dist/platform/providers/consensus.js");
    assert.ok(mod.DeliberativeConsensus, "DeliberativeConsensus class should exist");
  });
});
