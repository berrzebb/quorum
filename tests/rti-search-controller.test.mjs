#!/usr/bin/env node
/**
 * RTI-4: Transcript Search Controller Tests
 *
 * Tests the coordination layer between TranscriptIndex,
 * SearchStateProjection, and UI navigation.
 *
 * Run: node --test tests/rti-search-controller.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const {
  createSearchController,
  isSearchHitLine,
  isFocusedHitLine,
} = await import("../dist/daemon/lib/transcript-search.js");

describe("createSearchController", () => {
  let ctrl;

  beforeEach(() => {
    ctrl = createSearchController();
  });

  it("starts with empty search state", () => {
    assert.equal(ctrl.state.active, false);
    assert.equal(ctrl.state.query, "");
    assert.equal(ctrl.state.hits.length, 0);
  });

  it("feedLines indexes visible text", () => {
    const count = ctrl.feedLines("s1", [
      "Authentication module refactored",
      "Fixed login handler bug",
      "<system-reminder>hidden text</system-reminder>",
    ]);
    assert.equal(count, 2);
    assert.equal(ctrl.index.entryCount("s1"), 2);
  });

  it("search returns hits and updates state", () => {
    ctrl.feedLines("s1", [
      "Authentication module was updated",
      "Fixed a bug in the login handler",
      "Added regression tests for auth",
    ]);

    const state = ctrl.search("auth", "s1");
    assert.equal(state.active, true);
    assert.equal(state.query, "auth");
    assert.ok(state.hits.length >= 1);
    assert.equal(state.focusedHitIndex, 0);
    assert.equal(state.sessionId, "s1");
    assert.equal(typeof state.lastSearchMs, "number");
  });

  it("empty query clears search", () => {
    ctrl.feedLines("s1", ["some text"]);
    ctrl.search("text", "s1");
    assert.equal(ctrl.state.active, true);

    const state = ctrl.search("", "s1");
    assert.equal(state.active, false);
    assert.equal(state.hits.length, 0);
  });

  it("next/prev navigate hits", () => {
    ctrl.feedLines("s1", [
      "Error in module A",
      "Warning in module B",
      "Error in module C",
    ]);
    ctrl.search("module", "s1");
    assert.equal(ctrl.state.focusedHitIndex, 0);

    ctrl.next();
    assert.equal(ctrl.state.focusedHitIndex, 1);

    ctrl.next();
    assert.equal(ctrl.state.focusedHitIndex, 2);

    ctrl.next(); // wrap
    assert.equal(ctrl.state.focusedHitIndex, 0);

    ctrl.prev(); // wrap back
    assert.equal(ctrl.state.focusedHitIndex, 2);
  });

  it("clear resets to empty", () => {
    ctrl.feedLines("s1", ["some text"]);
    ctrl.search("text", "s1");
    assert.equal(ctrl.state.active, true);

    ctrl.clear();
    assert.equal(ctrl.state.active, false);
  });

  it("scrollToFocusedHit returns line number", () => {
    ctrl.feedLines("s1", [
      "first line",
      "target line with keyword",
      "third line",
    ]);
    ctrl.search("keyword", "s1");

    const line = ctrl.scrollToFocusedHit();
    assert.equal(typeof line, "number");
  });

  it("scrollToFocusedHit returns null when no search", () => {
    assert.equal(ctrl.scrollToFocusedHit(), null);
  });
});

describe("isSearchHitLine / isFocusedHitLine", () => {
  let ctrl;

  beforeEach(() => {
    ctrl = createSearchController();
    ctrl.feedLines("s1", [
      "line zero",
      "target keyword here",
      "another line",
      "keyword again",
    ]);
    ctrl.search("keyword", "s1");
  });

  it("isSearchHitLine returns true for hit lines", () => {
    const hitLines = ctrl.state.hits.map(h => h.line);
    for (const line of hitLines) {
      assert.equal(isSearchHitLine(ctrl.state, line), true);
    }
  });

  it("isSearchHitLine returns false for non-hit lines", () => {
    assert.equal(isSearchHitLine(ctrl.state, 99999), false);
  });

  it("isSearchHitLine returns false when no active search", () => {
    ctrl.clear();
    assert.equal(isSearchHitLine(ctrl.state, 0), false);
  });

  it("isFocusedHitLine returns true only for focused hit", () => {
    const focusedLine = ctrl.state.hits[ctrl.state.focusedHitIndex].line;
    assert.equal(isFocusedHitLine(ctrl.state, focusedLine), true);

    // Other hit lines are not focused
    if (ctrl.state.hits.length > 1) {
      const otherLine = ctrl.state.hits[1].line;
      if (otherLine !== focusedLine) {
        assert.equal(isFocusedHitLine(ctrl.state, otherLine), false);
      }
    }
  });
});
