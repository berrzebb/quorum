#!/usr/bin/env node
/**
 * RTI-5: LLM Compact Upgrade Tests
 *
 * Verifies that:
 * 1. Deterministic compact is always the safety floor
 * 2. LLM upgrade enriches summary when available
 * 3. LLM failure falls back to deterministic (never blocks handoff)
 * 4. Circuit breaker trips after consecutive LLM failures
 *
 * Run: node --test tests/rti-llm-compact.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  generateCompactWithUpgrade,
  generateCompactSummary,
  createCircuitBreaker,
  CIRCUIT_BREAKER_THRESHOLD,
} = await import("../dist/platform/orchestrate/execution/wave-compact.js");

const baseInput = {
  waveIndex: 3,
  trackName: "test-track",
  changedFiles: ["src/a.ts", "src/b.ts"],
  fitness: 0.82,
  findings: [
    { code: "type-safety", severity: "medium", summary: "missing type annotation" },
    { code: "test-gap", severity: "high", summary: "no test for edge case", file: "src/a.ts" },
  ],
  waveFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
  constraints: ["do not remove existing tests"],
};

// ═══ 1. No Summarizer — Pure Deterministic ══════════════════════════════

describe("RTI-5: No summarizer → deterministic only", () => {
  it("returns deterministic summary without LLM", async () => {
    const result = await generateCompactWithUpgrade(baseInput);
    assert.equal(result.summary.source, "generated");
    assert.equal(result.summary.waveIndex, 3);
    assert.equal(result.llmResult, undefined);
    assert.equal(result.breaker.failures, 0);
  });

  it("summary matches standalone deterministic", async () => {
    const standalone = generateCompactSummary(baseInput);
    const result = await generateCompactWithUpgrade(baseInput);
    assert.equal(result.summary.changedFiles.length, standalone.changedFiles.length);
    assert.equal(result.summary.fitness, standalone.fitness);
  });
});

// ═══ 2. Successful LLM Upgrade ══════════════════════════════════════════

describe("RTI-5: Successful LLM upgrade", () => {
  const mockSummarizer = {
    name: "mock-llm",
    async summarize(baseline) {
      return {
        enhancedSummary: `Enhanced: wave ${baseline.waveIndex} had ${baseline.changedFiles.length} files`,
        learnedConstraints: ["always run type-check before commit"],
        keyDecisions: ["chose immutable data structures"],
        tokenEstimate: 150,
      };
    },
  };

  it("merges learned constraints into summary", async () => {
    const result = await generateCompactWithUpgrade(baseInput, mockSummarizer);
    assert.ok(result.llmResult, "should have LLM result");
    assert.equal(result.llmResult.learnedConstraints.length, 1);
    assert.ok(result.summary.nextConstraints.includes("always run type-check before commit"));
    // Original constraints preserved
    assert.ok(result.summary.nextConstraints.includes("do not remove existing tests"));
  });

  it("LLM result has expected shape", async () => {
    const result = await generateCompactWithUpgrade(baseInput, mockSummarizer);
    assert.ok(result.llmResult);
    assert.equal(typeof result.llmResult.enhancedSummary, "string");
    assert.ok(result.llmResult.enhancedSummary.length > 0);
    assert.ok(Array.isArray(result.llmResult.keyDecisions));
    assert.equal(typeof result.llmResult.tokenEstimate, "number");
  });

  it("resets circuit breaker on success", async () => {
    const trippedBreaker = { failures: 2, tripped: false, lastError: "prev" };
    const result = await generateCompactWithUpgrade(baseInput, mockSummarizer, trippedBreaker);
    assert.equal(result.breaker.failures, 0);
    assert.equal(result.breaker.tripped, false);
  });
});

// ═══ 3. LLM Failure → Deterministic Fallback ════════════════════════════

describe("RTI-5: LLM failure → deterministic fallback", () => {
  const failingSummarizer = {
    name: "failing-llm",
    async summarize() {
      throw new Error("LLM service unavailable");
    },
  };

  it("returns deterministic summary on LLM failure", async () => {
    const result = await generateCompactWithUpgrade(baseInput, failingSummarizer);
    assert.equal(result.summary.source, "generated");
    assert.equal(result.llmResult, undefined);
    assert.ok(result.summary.changedFiles.length > 0);
  });

  it("increments circuit breaker failures", async () => {
    const result = await generateCompactWithUpgrade(baseInput, failingSummarizer);
    assert.equal(result.breaker.failures, 1);
    assert.ok(result.breaker.lastError.includes("LLM service unavailable"));
  });

  it("handoff is NEVER blocked by LLM failure", async () => {
    // Even after multiple failures, summary is always available
    let breaker = createCircuitBreaker();
    for (let i = 0; i < 5; i++) {
      const result = await generateCompactWithUpgrade(baseInput, failingSummarizer, breaker);
      assert.ok(result.summary, `Summary must exist on attempt ${i + 1}`);
      assert.ok(result.summary.changedFiles.length > 0);
      breaker = result.breaker;
    }
  });
});

// ═══ 4. Circuit Breaker ═════════════════════════════════════════════════

describe("RTI-5: Circuit breaker behavior", () => {
  const failingSummarizer = {
    name: "flaky-llm",
    async summarize() {
      throw new Error("timeout");
    },
  };

  it("trips after N consecutive failures", async () => {
    let breaker = createCircuitBreaker();
    for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
      const result = await generateCompactWithUpgrade(baseInput, failingSummarizer, breaker);
      breaker = result.breaker;
    }
    assert.equal(breaker.tripped, true);
    assert.equal(breaker.failures, CIRCUIT_BREAKER_THRESHOLD);
  });

  it("skips LLM when breaker is tripped", async () => {
    let callCount = 0;
    const countingSummarizer = {
      name: "counting-llm",
      async summarize() {
        callCount++;
        return {
          enhancedSummary: "ok",
          learnedConstraints: [],
          keyDecisions: [],
          tokenEstimate: 10,
        };
      },
    };

    const trippedBreaker = { failures: CIRCUIT_BREAKER_THRESHOLD, tripped: true };
    await generateCompactWithUpgrade(baseInput, countingSummarizer, trippedBreaker);
    assert.equal(callCount, 0, "Should NOT call summarizer when breaker tripped");
  });
});
