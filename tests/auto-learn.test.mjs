#!/usr/bin/env node
/**
 * Phase 6 Tests: Auto-Learning — Pattern Detection + Rule Suggestions
 *
 * Run: node --test tests/auto-learn.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";

import { createTempStore, cleanup } from "./helpers.mjs";

const { MessageBus } = await import("../dist/platform/bus/message-bus.js");
const { detectRepeatPatterns, suggestRules, analyzeAndSuggest } = await import("../dist/platform/bus/auto-learn.js");
const { createEvent } = await import("../dist/platform/bus/events.js");

// Helper: submit N findings with same category
function submitFindings(bus, category, count, severity = "major") {
  for (let i = 0; i < count; i++) {
    bus.submitFindings([{
      reviewerId: `reviewer-${i}`,
      provider: "codex",
      severity,
      category,
      description: `${category} issue #${i + 1}: sample description`,
      file: `src/file-${i % 3}.ts`,
    }], "claude-code", `reviewer-${i}`, "codex");
  }
}

// ═══ 1. Pattern Detection ═══════════════════════════════════

describe("Pattern Detection", () => {
  let store, dir, bus;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    bus = new MessageBus(store);
  });

  it("detects category appearing 3+ times", () => {
    submitFindings(bus, "null-check", 4);
    const patterns = detectRepeatPatterns(store);

    assert.ok(patterns.length > 0);
    const nullCheck = patterns.find(p => p.key === "null-check");
    assert.ok(nullCheck);
    assert.equal(nullCheck.count, 4);
    assert.equal(nullCheck.type, "category");
  });

  it("ignores categories below threshold", () => {
    submitFindings(bus, "rare-issue", 2);
    const patterns = detectRepeatPatterns(store);
    assert.ok(!patterns.some(p => p.key === "rare-issue"));
  });

  it("tracks severity correctly", () => {
    submitFindings(bus, "security", 5, "critical");
    const patterns = detectRepeatPatterns(store);
    const sec = patterns.find(p => p.key === "security");
    assert.equal(sec.severity, "critical");
  });

  it("collects sample descriptions", () => {
    submitFindings(bus, "naming", 4);
    const patterns = detectRepeatPatterns(store);
    const naming = patterns.find(p => p.key === "naming");
    assert.ok(naming.samples.length > 0);
    assert.ok(naming.samples.length <= 3);
  });

  it("identifies top files", () => {
    submitFindings(bus, "error-handling", 6);
    const patterns = detectRepeatPatterns(store);
    const eh = patterns.find(p => p.key === "error-handling");
    assert.ok(eh.topFiles.length > 0);
  });

  it("tracks dismissal count", () => {
    const ids = bus.submitFindings([
      { reviewerId: "r1", provider: "codex", severity: "minor", category: "style", description: "style issue 1" },
      { reviewerId: "r1", provider: "codex", severity: "minor", category: "style", description: "style issue 2" },
      { reviewerId: "r1", provider: "codex", severity: "minor", category: "style", description: "style issue 3" },
    ], "claude-code", "r1", "codex");

    bus.ackFinding(ids[0], "dismiss");
    bus.ackFinding(ids[1], "dismiss");

    const patterns = detectRepeatPatterns(store);
    const style = patterns.find(p => p.key === "style");
    assert.ok(style);
    assert.equal(style.dismissedCount, 2);
  });

  it("detects rejection code patterns", () => {
    for (let i = 0; i < 4; i++) {
      store.append(createEvent("audit.verdict", "codex", {
        itemId: `TN-${i}`,
        verdict: "changes_requested",
        codes: ["perf-gap", "doc-stale"],
      }));
    }

    const patterns = detectRepeatPatterns(store);
    const perfGap = patterns.find(p => p.key === "perf-gap");
    assert.ok(perfGap);
    assert.equal(perfGap.type, "rejection_code");
    assert.equal(perfGap.count, 4);
  });

  it("sorts patterns by count descending", () => {
    submitFindings(bus, "minor-issue", 3);
    submitFindings(bus, "major-issue", 7);
    submitFindings(bus, "medium-issue", 5);

    const patterns = detectRepeatPatterns(store);
    assert.equal(patterns[0].key, "major-issue");
    assert.equal(patterns[1].key, "medium-issue");
    assert.equal(patterns[2].key, "minor-issue");
  });

  it("empty store returns no patterns", () => {
    const patterns = detectRepeatPatterns(store);
    assert.equal(patterns.length, 0);
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});

// ═══ 2. Rule Suggestions ═══════════════════════════════════

describe("Rule Suggestions", () => {
  let store, dir, bus;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    bus = new MessageBus(store);
  });

  it("generates rule text from category pattern", () => {
    submitFindings(bus, "error-handling", 5, "major");
    const patterns = detectRepeatPatterns(store);
    const suggestions = suggestRules(patterns);

    assert.ok(suggestions.length > 0);
    assert.ok(suggestions[0].ruleText.includes("error-handling"));
    assert.ok(suggestions[0].ruleText.includes("5 times"));
    assert.ok(suggestions[0].confidence > 0.3);
  });

  it("generates rule text from rejection code pattern", () => {
    for (let i = 0; i < 5; i++) {
      store.append(createEvent("audit.verdict", "codex", {
        itemId: `TN-${i}`,
        verdict: "changes_requested",
        codes: ["compat-break"],
      }));
    }

    const patterns = detectRepeatPatterns(store);
    const suggestions = suggestRules(patterns);
    const compat = suggestions.find(s => s.pattern.key === "compat-break");
    assert.ok(compat);
    assert.ok(compat.ruleText.includes("compat-break"));
  });

  it("higher severity increases confidence", () => {
    submitFindings(bus, "critical-bug", 5, "critical");
    submitFindings(bus, "style-nit", 5, "style");

    const patterns = detectRepeatPatterns(store);
    const suggestions = suggestRules(patterns);

    const critSug = suggestions.find(s => s.pattern.key === "critical-bug");
    const styleSug = suggestions.find(s => s.pattern.key === "style-nit");
    assert.ok(critSug.confidence > styleSug.confidence);
  });

  it("high dismiss rate lowers confidence", () => {
    const ids = bus.submitFindings(
      Array.from({ length: 5 }, (_, i) => ({
        reviewerId: "r1", provider: "codex", severity: "major",
        category: "false-positive-prone", description: `issue ${i}`,
      })),
      "claude-code", "r1", "codex",
    );

    // Dismiss 4 out of 5
    for (let i = 0; i < 4; i++) {
      bus.ackFinding(ids[i], "dismiss");
    }

    const patterns = detectRepeatPatterns(store);
    const suggestions = suggestRules(patterns);
    const fp = suggestions.find(s => s.pattern.key === "false-positive-prone");
    // Should be filtered out (confidence < 0.3) or have low confidence
    if (fp) {
      assert.ok(fp.confidence <= 0.5);
    }
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});

// ═══ 3. Combined Analysis ═══════════════════════════════════

describe("analyzeAndSuggest", () => {
  let store, dir, bus;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    bus = new MessageBus(store);
  });

  it("returns full summary", () => {
    submitFindings(bus, "sql-injection", 4, "critical");
    store.append(createEvent("audit.verdict", "codex", {
      itemId: "TN-1", verdict: "changes_requested", codes: ["sec-vuln"],
    }));

    const summary = analyzeAndSuggest(store);
    assert.ok(summary.patterns.length > 0);
    assert.ok(summary.eventsAnalyzed > 0);
    assert.ok(Array.isArray(summary.suggestions));
  });

  it("empty store returns clean summary", () => {
    const summary = analyzeAndSuggest(store);
    assert.equal(summary.patterns.length, 0);
    assert.equal(summary.suggestions.length, 0);
    assert.equal(summary.eventsAnalyzed, 0);
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});
