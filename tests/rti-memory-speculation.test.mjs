#!/usr/bin/env node
/**
 * RTI-6: Session Memory Carryover Tests
 *
 * Run: node --test tests/rti-memory-speculation.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  createMemoryDigest,
  addMemory,
  extractMemories,
  formatMemoryContext,
  generateCompactSummary,
} = await import("../dist/platform/orchestrate/execution/wave-compact.js");

// ═══ RTI-6: Memory Digest ═══════════════════════════════════════════════

describe("RTI-6: createMemoryDigest", () => {
  it("creates empty digest with default max", () => {
    const digest = createMemoryDigest();
    assert.equal(digest.entries.length, 0);
    assert.equal(digest.maxEntries, 5);
    assert.equal(digest.tokenEstimate, 0);
  });

  it("respects custom maxEntries", () => {
    const digest = createMemoryDigest(3);
    assert.equal(digest.maxEntries, 3);
  });
});

describe("RTI-6: addMemory", () => {
  it("adds entry to digest", () => {
    let digest = createMemoryDigest();
    digest = addMemory(digest, {
      content: "Always run tests before commit",
      sourceWave: 1,
      category: "constraint",
      importance: 0.8,
    });
    assert.equal(digest.entries.length, 1);
    assert.ok(digest.tokenEstimate > 0);
  });

  it("respects maxEntries bound", () => {
    let digest = createMemoryDigest(2);
    digest = addMemory(digest, { content: "A", sourceWave: 1, category: "constraint", importance: 0.5 });
    digest = addMemory(digest, { content: "B", sourceWave: 1, category: "learned", importance: 0.6 });
    assert.equal(digest.entries.length, 2);

    // Third entry replaces lowest importance
    digest = addMemory(digest, { content: "C", sourceWave: 2, category: "constraint", importance: 0.9 });
    assert.equal(digest.entries.length, 2);
    assert.ok(digest.entries.some(e => e.content === "C"), "Should contain high-importance entry");
    assert.ok(!digest.entries.some(e => e.content === "A"), "Should have replaced lowest importance");
  });

  it("does not replace if new entry is lower importance", () => {
    let digest = createMemoryDigest(1);
    digest = addMemory(digest, { content: "Important", sourceWave: 1, category: "constraint", importance: 0.9 });
    digest = addMemory(digest, { content: "Less important", sourceWave: 2, category: "learned", importance: 0.3 });
    assert.equal(digest.entries[0].content, "Important");
  });
});

describe("RTI-6: extractMemories", () => {
  it("extracts unresolved findings as memories", () => {
    const summary = generateCompactSummary({
      waveIndex: 2,
      trackName: "test",
      changedFiles: ["a.ts"],
      fitness: 0.75,
      findings: [
        { code: "security-issue", severity: "high", summary: "SQL injection risk", file: "a.ts" },
        { code: "style", severity: "low", summary: "naming convention" },
      ],
      waveFiles: ["a.ts"],
    });

    const memories = extractMemories(summary);
    // Only high-severity findings become memories
    const unresolved = memories.filter(m => m.category === "unresolved");
    assert.ok(unresolved.length >= 1);
    assert.ok(unresolved[0].content.includes("security-issue"));
    assert.equal(unresolved[0].importance, 0.9);
  });

  it("extracts constraints as memories", () => {
    const summary = generateCompactSummary({
      waveIndex: 1,
      trackName: "test",
      changedFiles: [],
      fitness: 0.8,
      findings: [],
      waveFiles: [],
      constraints: ["do not modify public API"],
    });

    const memories = extractMemories(summary);
    const constraints = memories.filter(m => m.category === "constraint");
    assert.ok(constraints.length >= 1);
  });

  it("extracts LLM learned constraints when available", () => {
    const summary = generateCompactSummary({
      waveIndex: 1,
      trackName: "test",
      changedFiles: [],
      fitness: 0.8,
      findings: [],
      waveFiles: [],
    });

    const llmResult = {
      enhancedSummary: "test",
      learnedConstraints: ["always validate input"],
      keyDecisions: ["used immutable pattern"],
      tokenEstimate: 50,
    };

    const memories = extractMemories(summary, llmResult);
    assert.ok(memories.some(m => m.category === "learned" && m.content === "always validate input"));
    assert.ok(memories.some(m => m.category === "decision"));
  });
});

describe("RTI-6: formatMemoryContext", () => {
  it("returns empty string for empty digest", () => {
    const digest = createMemoryDigest();
    assert.equal(formatMemoryContext(digest), "");
  });

  it("formats non-empty digest as markdown", () => {
    let digest = createMemoryDigest();
    digest = addMemory(digest, { content: "Rule 1", sourceWave: 1, category: "constraint", importance: 0.8 });
    digest = addMemory(digest, { content: "Lesson 1", sourceWave: 2, category: "learned", importance: 0.7 });

    const formatted = formatMemoryContext(digest);
    assert.ok(formatted.includes("Session Memory"));
    assert.ok(formatted.includes("[constraint] Rule 1"));
    assert.ok(formatted.includes("[learned] Lesson 1"));
  });
});

