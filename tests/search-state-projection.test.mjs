#!/usr/bin/env node
/**
 * RTI-3C: Search State Projection Tests
 *
 * Verifies that daemon UI can consume search results through
 * state projection rather than calling the index directly.
 *
 * Run: node --test tests/search-state-projection.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  emptySearchState,
  projectSearchState,
  nextSearchHit,
  prevSearchHit,
} = await import("../dist/platform/bus/provider-session-projector.js");

const { TranscriptIndex } = await import("../dist/platform/bus/transcript-index.js");

// ═══ 1. Empty Search State ══════════════════════════════════════════════

describe("emptySearchState", () => {
  it("returns inactive state with no hits", () => {
    const state = emptySearchState();
    assert.equal(state.active, false);
    assert.equal(state.query, "");
    assert.equal(state.hits.length, 0);
    assert.equal(state.focusedHitIndex, -1);
    assert.equal(state.indexedLineCount, 0);
  });
});

// ═══ 2. Search State Projection ═════════════════════════════════════════

describe("projectSearchState", () => {
  it("creates active state from query results", () => {
    const hits = [
      { sessionId: "s1", line: 10, excerpt: "found here", score: 0.8, section: "assistant" },
      { sessionId: "s1", line: 25, excerpt: "also here", score: 0.5 },
    ];

    const state = projectSearchState("test query", "session", hits, 500, 12, "s1");
    assert.equal(state.active, true);
    assert.equal(state.query, "test query");
    assert.equal(state.scope, "session");
    assert.equal(state.sessionId, "s1");
    assert.equal(state.hits.length, 2);
    assert.equal(state.focusedHitIndex, 0);
    assert.equal(state.indexedLineCount, 500);
    assert.equal(state.lastSearchMs, 12);
  });

  it("empty query → inactive state", () => {
    const state = projectSearchState("", "session", [], 100);
    assert.equal(state.active, false);
    assert.equal(state.focusedHitIndex, -1);
  });

  it("no hits → focusedHitIndex is -1", () => {
    const state = projectSearchState("query", "session", [], 100);
    assert.equal(state.focusedHitIndex, -1);
  });
});

// ═══ 3. Hit Navigation ══════════════════════════════════════════════════

describe("Search hit navigation", () => {
  const hits = [
    { sessionId: "s1", line: 5, excerpt: "hit 0", score: 1.0 },
    { sessionId: "s1", line: 10, excerpt: "hit 1", score: 0.8 },
    { sessionId: "s1", line: 20, excerpt: "hit 2", score: 0.6 },
  ];

  it("nextSearchHit advances focus", () => {
    let state = projectSearchState("test", "session", hits, 100);
    assert.equal(state.focusedHitIndex, 0);

    state = nextSearchHit(state);
    assert.equal(state.focusedHitIndex, 1);

    state = nextSearchHit(state);
    assert.equal(state.focusedHitIndex, 2);
  });

  it("nextSearchHit wraps around", () => {
    let state = projectSearchState("test", "session", hits, 100);
    state = { ...state, focusedHitIndex: 2 };

    state = nextSearchHit(state);
    assert.equal(state.focusedHitIndex, 0);
  });

  it("prevSearchHit goes backward", () => {
    let state = projectSearchState("test", "session", hits, 100);
    state = { ...state, focusedHitIndex: 2 };

    state = prevSearchHit(state);
    assert.equal(state.focusedHitIndex, 1);
  });

  it("prevSearchHit wraps around from 0", () => {
    let state = projectSearchState("test", "session", hits, 100);
    assert.equal(state.focusedHitIndex, 0);

    state = prevSearchHit(state);
    assert.equal(state.focusedHitIndex, 2);
  });

  it("navigation on empty hits is no-op", () => {
    const state = emptySearchState();
    assert.equal(nextSearchHit(state).focusedHitIndex, -1);
    assert.equal(prevSearchHit(state).focusedHitIndex, -1);
  });
});

// ═══ 4. Integration: Index → Projection ═════════════════════════════════

describe("Index → Projection integration", () => {
  it("TranscriptIndex query feeds into projectSearchState", () => {
    const index = new TranscriptIndex();
    index.appendBatch("s1", [
      "Authentication module was updated",
      "Fixed a critical security bug",
      "Added regression tests for auth flow",
    ]);

    const start = Date.now();
    const hits = index.query("s1", "auth");
    const elapsed = Date.now() - start;

    const state = projectSearchState(
      "auth",
      "session",
      hits.map(h => ({
        sessionId: h.sessionId,
        line: h.line,
        excerpt: h.excerpt,
        score: h.score,
        section: h.section,
      })),
      index.entryCount("s1"),
      elapsed,
      "s1",
    );

    assert.equal(state.active, true);
    assert.equal(state.query, "auth");
    assert.ok(state.hits.length >= 1);
    assert.equal(state.indexedLineCount, 3);
    assert.equal(typeof state.lastSearchMs, "number");
  });
});
