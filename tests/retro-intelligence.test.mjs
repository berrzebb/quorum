#!/usr/bin/env node
/**
 * RDI-3: Signal Gathering + RDI-4: Consolidation + Prune + Digest
 *
 * Run: node --test tests/retro-intelligence.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  orient,
  gatherFromAudit,
  gatherFromCompact,
  gatherFromMemory,
  gatherFromTranscript,
  gatherSignals,
} = await import("../platform/core/retro/signal-gatherer.mjs");

const { consolidate } = await import("../platform/core/retro/consolidate.mjs");
const { planPrune, applyPrune } = await import("../platform/core/retro/prune.mjs");
const {
  generateDigest,
  selectCarryover,
  formatDigestContext,
  serializeDigest,
  deserializeDigest,
  summarizeDigest,
  MAX_CARRYOVER_TOTAL,
} = await import("../platform/core/retro/digest.mjs");

// ═══ RDI-3: Orient ═════════════════════════════════════

describe("RDI-3: orient", () => {
  it("extracts known topics from existing memory", () => {
    const ctx = orient({
      trackName: "RDI",
      waveIndex: 3,
      existingMemory: [
        { content: "[type-safety] Always check return types" },
        { content: "Use strict mode for all modules" },
      ],
    });
    assert.equal(ctx.trackName, "RDI");
    assert.equal(ctx.waveIndex, 3);
    assert.ok(ctx.knownTopics.includes("type-safety"));
    assert.equal(ctx.knownTopics.length, 2);
  });

});

// ═══ RDI-3: Audit Gathering ════════════════════════════

describe("RDI-3: gatherFromAudit", () => {
  it("detects repeated rejection codes (3+)", () => {
    const records = [
      { rejection_codes: ["CQ", "T"] },
      { rejection_codes: ["CQ"] },
      { rejection_codes: ["CQ", "SEC"] },
      { rejection_codes: ["T"] },
    ];
    const ctx = orient({ trackName: "T", waveIndex: 1 });
    const signals = gatherFromAudit(records, ctx);
    const cqSignal = signals.find(s => s.topic === "CQ");
    assert.ok(cqSignal, "Should detect CQ as repeated (3 times)");
    assert.equal(cqSignal.kind, "finding_repeat");
    assert.ok(cqSignal.content.includes("3 times"));
  });

  it("ignores codes with fewer than 3 occurrences", () => {
    const records = [
      { rejection_codes: ["T"] },
      { rejection_codes: ["T"] },
    ];
    const ctx = orient({ trackName: "T", waveIndex: 1 });
    const signals = gatherFromAudit(records, ctx);
    assert.equal(signals.filter(s => s.topic === "T").length, 0);
  });

  it("detects multiple recent failures as constraint", () => {
    const records = [
      { verdict: "rejected", summary: "Missing tests" },
      { verdict: "rejected", summary: "Type errors" },
    ];
    const ctx = orient({ trackName: "T", waveIndex: 1 });
    const signals = gatherFromAudit(records, ctx);
    const constraint = signals.find(s => s.kind === "constraint");
    assert.ok(constraint);
    assert.ok(constraint.content.includes("2 recent audit failures"));
  });
});

// ═══ RDI-3: Compact Gathering ══════════════════════════

describe("RDI-3: gatherFromCompact", () => {
  it("extracts high-severity unresolved findings", () => {
    const summaries = [{
      waveIndex: 2,
      generatedAt: Date.now(),
      unresolvedFindings: [
        { code: "type-safety", severity: "high", summary: "Missing return type", file: "a.ts" },
        { code: "style", severity: "low", summary: "Formatting" },
      ],
      nextConstraints: ["Do not use any"],
    }];
    const ctx = orient({ trackName: "T", waveIndex: 3 });
    const signals = gatherFromCompact(summaries, ctx);
    assert.ok(signals.some(s => s.topic === "type-safety" && s.weight === 0.9));
    assert.ok(signals.some(s => s.kind === "constraint"));
    // Low severity should be excluded
    assert.ok(!signals.some(s => s.topic === "style"));
  });
});

// ═══ RDI-3: Memory Gathering ═══════════════════════════

describe("RDI-3: gatherFromMemory", () => {
  it("detects duplicate memory entries", () => {
    const entries = [
      { content: "Always check return types", importance: 0.8, sourceWave: 1 },
      { content: "always check return types", importance: 0.5, sourceWave: 2 },
    ];
    const ctx = orient({ trackName: "T", waveIndex: 3 });
    const signals = gatherFromMemory(entries, ctx);
    assert.ok(signals.some(s => s.kind === "prune_candidate" && s.topic === "duplicate-memory"));
  });

  it("detects stale entries (5+ waves old)", () => {
    const entries = [
      { content: "Old constraint from wave 0", importance: 0.3, sourceWave: 0 },
    ];
    const ctx = orient({ trackName: "T", waveIndex: 6 });
    const signals = gatherFromMemory(entries, ctx);
    assert.ok(signals.some(s => s.kind === "prune_candidate" && s.topic === "stale-memory"));
  });
});

// ═══ RDI-3: Transcript Gathering ═══════════════════════

describe("RDI-3: gatherFromTranscript", () => {
  it("detects repeated error patterns", () => {
    const lines = [
      "error: Cannot find module 'foo'",
      "error: Cannot find module 'foo'",
      "warning: something else",
      "error: Cannot find module 'foo'",
    ];
    const ctx = orient({ trackName: "T", waveIndex: 1 });
    const signals = gatherFromTranscript(lines, ctx);
    assert.ok(signals.some(s => s.kind === "finding_repeat" && s.topic === "repeated-error"));
  });

  it("detects explicit decision markers", () => {
    const lines = [
      "DECISION: Use SQLite for all state",
      "Regular conversation line",
      "CONFIRMED: No markdown file I/O in hooks",
    ];
    const ctx = orient({ trackName: "T", waveIndex: 1 });
    const signals = gatherFromTranscript(lines, ctx);
    const decisions = signals.filter(s => s.kind === "decision");
    assert.equal(decisions.length, 2);
  });
});

// ═══ RDI-3: Full Pipeline ══════════════════════════════

describe("RDI-3: gatherSignals (full pipeline)", () => {
  it("deduplicates signals across sources", () => {
    const result = gatherSignals({
      trackName: "T",
      waveIndex: 3,
      auditRecords: [
        { rejection_codes: ["CQ"] },
        { rejection_codes: ["CQ"] },
        { rejection_codes: ["CQ"] },
      ],
      compactSummaries: [{
        waveIndex: 2,
        unresolvedFindings: [{ code: "CQ", severity: "high", summary: "Code quality" }],
        nextConstraints: [],
      }],
    });
    // CQ appears as finding_repeat from both audit and compact, should be deduped
    const cqSignals = result.signals.filter(s => s.topic === "CQ");
    assert.equal(cqSignals.length, 1, "Should deduplicate by topic+kind");
    assert.ok(result.stats.totalDeduped >= 1);
  });

  it("returns stats for each source", () => {
    const result = gatherSignals({
      trackName: "T",
      waveIndex: 1,
      auditRecords: [],
      compactSummaries: [],
      memoryEntries: [],
      transcriptLines: [],
    });
    assert.equal(result.stats.auditSignals, 0);
    assert.equal(result.stats.compactSignals, 0);
    assert.equal(result.stats.memorySignals, 0);
    assert.equal(result.stats.transcriptSignals, 0);
  });
});

// ═══ RDI-4: Consolidate ════════════════════════════════

describe("RDI-4: consolidate", () => {
  it("groups signals by kind", () => {
    const signals = [
      { kind: "finding_repeat", topic: "CQ", content: "CQ repeated 3x", weight: 0.8, source: "audit", timestamp: 0 },
      { kind: "constraint", topic: "wave-c", content: "Use strict types", weight: 0.7, source: "compact", timestamp: 0 },
      { kind: "decision", topic: "explicit-decision", content: "DECIDED: SQLite only", weight: 0.7, source: "transcript", timestamp: 0 },
    ];
    const result = consolidate(signals);
    assert.ok(result.repeatedFailures.length > 0);
    assert.ok(result.learnedConstraints.length > 0);
    assert.ok(result.confirmedDecisions.length > 0);
    assert.ok(result.nextWaveGuidance.length > 0);
  });

  it("respects bounded limits", () => {
    const signals = Array.from({ length: 20 }, (_, i) => ({
      kind: "constraint",
      topic: `c-${i}`,
      content: `Constraint ${i}`,
      weight: 1 - i * 0.01,
      source: "audit",
      timestamp: 0,
    }));
    const result = consolidate(signals, { maxConstraints: 3 });
    assert.equal(result.learnedConstraints.length, 3);
  });

  it("is deterministic (same input → same output)", () => {
    const signals = [
      { kind: "finding_repeat", topic: "A", content: "A repeated", weight: 0.8, source: "audit", timestamp: 0 },
      { kind: "constraint", topic: "B", content: "B constraint", weight: 0.7, source: "compact", timestamp: 0 },
    ];
    const result1 = consolidate(signals);
    const result2 = consolidate(signals);
    assert.deepEqual(result1, result2);
  });
});

// ═══ RDI-4: Prune ══════════════════════════════════════

describe("RDI-4: planPrune", () => {
  it("detects duplicate memory for merge", () => {
    const signals = [];
    const entries = [
      { content: "Always check types", importance: 0.8, sourceWave: 1 },
      { content: "always check types", importance: 0.5, sourceWave: 2 },
    ];
    const journal = planPrune(signals, entries);
    assert.ok(journal.decisions.some(d => d.decision === "merge"));
    assert.equal(journal.merged, 1);
  });

  it("keeps entries by default (conservative)", () => {
    const signals = [];
    const entries = [
      { content: "Unique entry A", importance: 0.8, sourceWave: 1 },
      { content: "Unique entry B", importance: 0.7, sourceWave: 2 },
    ];
    const journal = planPrune(signals, entries);
    assert.equal(journal.kept, 2);
    assert.equal(journal.removed, 0);
  });

  it("every decision has target + decision + reason", () => {
    const signals = [];
    const entries = [
      { content: "Entry 1", importance: 0.5 },
      { content: "entry 1", importance: 0.3 }, // duplicate
    ];
    const journal = planPrune(signals, entries);
    for (const d of journal.decisions) {
      assert.ok(d.target, "must have target");
      assert.ok(d.decision, "must have decision");
      assert.ok(d.reason, "must have reason");
    }
  });
});

describe("RDI-4: applyPrune", () => {
  it("removes merged entries", () => {
    const entries = [
      { content: "Keep this", importance: 0.8 },
      { content: "Merge away", importance: 0.3 },
    ];
    const decisions = [
      { targetIndex: 0, decision: "keep", target: "Keep", reason: "ok" },
      { targetIndex: 1, decision: "merge", target: "Merge", reason: "dup", replacementTarget: "Keep" },
    ];
    const result = applyPrune(entries, decisions);
    assert.equal(result.length, 1);
    assert.equal(result[0].content, "Keep this");
  });

  it("demotes entries by reducing importance", () => {
    const entries = [
      { content: "Old", importance: 0.6 },
    ];
    const decisions = [
      { targetIndex: 0, decision: "demote", target: "Old", reason: "stale" },
    ];
    const result = applyPrune(entries, decisions);
    assert.equal(result.length, 1);
    assert.ok(result[0].importance < 0.6, "importance should decrease");
  });
});

// ═══ RDI-4: Digest ═════════════════════════════════════

describe("RDI-4: generateDigest", () => {
  it("produces a complete digest", () => {
    const consolidation = {
      learnedConstraints: ["C1"],
      repeatedFailures: ["F1"],
      confirmedDecisions: ["D1"],
      nextWaveGuidance: ["G1"],
    };
    const pruneJournal = {
      decisions: [{ target: "x", decision: "keep", reason: "ok" }],
      totalReviewed: 1,
      kept: 1,
      merged: 0,
      removed: 0,
      demoted: 0,
    };
    const digest = generateDigest({
      trackName: "RDI",
      waveIndex: 3,
      consolidation,
      pruneJournal,
      source: "wave-end",
    });
    assert.ok(digest.id.startsWith("digest-RDI-3-"));
    assert.equal(digest.trackName, "RDI");
    assert.equal(digest.waveIndex, 3);
    assert.equal(digest.learnedConstraints.length, 1);
    assert.equal(digest.source, "wave-end");
    assert.ok(digest.generatedAt > 0);
  });
});

describe("RDI-4: selectCarryover", () => {
  it("bounded by MAX_CARRYOVER_TOTAL", () => {
    const digest = {
      learnedConstraints: ["C1", "C2", "C3", "C4"],
      repeatedFailures: ["F1", "F2", "F3"],
      confirmedDecisions: [],
      nextWaveGuidance: ["G1", "G2"],
      pruneDecisions: [],
    };
    const items = selectCarryover(digest);
    assert.ok(items.length <= MAX_CARRYOVER_TOTAL);
    // Priority: constraints first
    assert.ok(items[0].includes("[constraint]"));
  });

});

describe("RDI-4: digest serialization", () => {
  it("roundtrips through serialize/deserialize", () => {
    const digest = generateDigest({
      trackName: "T",
      consolidation: {
        learnedConstraints: ["C1"],
        repeatedFailures: [],
        confirmedDecisions: [],
        nextWaveGuidance: [],
      },
      pruneJournal: { decisions: [], totalReviewed: 0, kept: 0, merged: 0, removed: 0, demoted: 0 },
      source: "manual",
    });
    const json = serializeDigest(digest);
    const restored = deserializeDigest(json);
    assert.equal(restored.trackName, "T");
    assert.equal(restored.learnedConstraints[0], "C1");
  });

  it("deserialize returns null for bad JSON", () => {
    assert.equal(deserializeDigest("NOT JSON"), null);
  });
});

describe("RDI-4: formatDigestContext", () => {
  it("produces markdown with carryover items", () => {
    const digest = {
      trackName: "T",
      waveIndex: 2,
      source: "wave-end",
      learnedConstraints: ["Always validate"],
      repeatedFailures: ["Missing tests"],
      confirmedDecisions: [],
      nextWaveGuidance: [],
      pruneDecisions: [],
    };
    const text = formatDigestContext(digest);
    assert.ok(text.includes("Retro Intelligence"));
    assert.ok(text.includes("[constraint]"));
    assert.ok(text.includes("[failure]"));
  });

  it("returns empty for empty digest", () => {
    const digest = {
      learnedConstraints: [],
      repeatedFailures: [],
      confirmedDecisions: [],
      nextWaveGuidance: [],
      pruneDecisions: [],
    };
    assert.equal(formatDigestContext(digest), "");
  });
});

describe("RDI-4: summarizeDigest", () => {
  it("produces human-readable summary", () => {
    const digest = {
      source: "wave-end",
      learnedConstraints: ["C1", "C2"],
      repeatedFailures: ["F1"],
      confirmedDecisions: [],
      nextWaveGuidance: ["G1"],
      pruneDecisions: [
        { decision: "keep" },
        { decision: "merge" },
      ],
    };
    const summary = summarizeDigest(digest);
    assert.ok(summary.includes("2 constraints"));
    assert.ok(summary.includes("1 repeated"));
    assert.ok(summary.includes("1 prune action"));
  });
});

// ═══ RDI-3+4: Full Pipeline ═══════════════════════════

describe("RDI-3+4: full gather → consolidate → prune → digest", () => {
  it("end-to-end deterministic pipeline", () => {
    const gatherResult = gatherSignals({
      trackName: "TEST",
      waveIndex: 5,
      auditRecords: [
        { rejection_codes: ["CQ"], verdict: "rejected", summary: "Bad code quality" },
        { rejection_codes: ["CQ", "T"], verdict: "rejected", summary: "Missing tests" },
        { rejection_codes: ["CQ"], verdict: "rejected", summary: "Type errors" },
      ],
      compactSummaries: [{
        waveIndex: 4,
        unresolvedFindings: [
          { code: "type-safety", severity: "high", summary: "Missing return type" },
        ],
        nextConstraints: ["Always add return types"],
      }],
      memoryEntries: [
        { content: "Old wave 0 memory", importance: 0.3, sourceWave: 0 },
        { content: "Recent constraint", importance: 0.8, sourceWave: 4 },
      ],
      transcriptLines: [
        "DECISION: Use SQLite for state",
        "error: type mismatch in module A",
        "error: type mismatch in module A",
      ],
    });

    assert.ok(gatherResult.signals.length > 0);

    const consolidation = consolidate(gatherResult.signals);
    assert.ok(consolidation.learnedConstraints.length > 0 || consolidation.repeatedFailures.length > 0);

    const pruneJournal = planPrune(gatherResult.signals, [
      { content: "Old wave 0 memory", importance: 0.3, sourceWave: 0 },
      { content: "Recent constraint", importance: 0.8, sourceWave: 4 },
    ]);
    assert.ok(pruneJournal.decisions.length > 0);
    // Every decision has reason
    for (const d of pruneJournal.decisions) {
      assert.ok(d.reason, `Decision for "${d.target}" must have reason`);
    }

    const digest = generateDigest({
      trackName: "TEST",
      waveIndex: 5,
      consolidation,
      pruneJournal,
      source: "wave-end",
      stats: gatherResult.stats,
    });
    assert.ok(digest.id);
    assert.equal(digest.trackName, "TEST");

    // Carryover is bounded
    const carryover = selectCarryover(digest);
    assert.ok(carryover.length <= MAX_CARRYOVER_TOTAL);

    // Deterministic: same inputs → same consolidation
    const consolidation2 = consolidate(gatherResult.signals);
    assert.deepEqual(consolidation, consolidation2);
  });
});
