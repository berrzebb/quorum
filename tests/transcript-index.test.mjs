#!/usr/bin/env node
/**
 * RTI-3B: Transcript Index — Append + Query Primitive Tests
 *
 * Run: node --test tests/transcript-index.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { TranscriptIndex } = await import("../dist/platform/bus/transcript-index.js");

describe("TranscriptIndex — append", () => {
  let index;
  beforeEach(() => { index = new TranscriptIndex(); });

  it("indexes visible text from JSON user message", () => {
    const json = JSON.stringify({ type: "message", role: "user", content: "Hello world" });
    const result = index.append("s1", json);
    assert.equal(result, true);
    assert.equal(index.entryCount("s1"), 1);
  });

  it("skips hidden system reminders", () => {
    const result = index.append("s1", "<system-reminder>hidden</system-reminder>");
    assert.equal(result, false);
    assert.equal(index.entryCount("s1"), 0);
  });

  it("skips metadata-only JSON", () => {
    const json = JSON.stringify({ id: "msg_1", model: "claude", usage: { tokens: 10 } });
    const result = index.append("s1", json);
    assert.equal(result, false);
  });

  it("appendBatch returns count of indexed lines", () => {
    const lines = [
      JSON.stringify({ type: "message", role: "user", content: "Line 1" }),
      "<system-reminder>hidden</system-reminder>",
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Line 2" } }),
    ];
    const count = index.appendBatch("s1", lines);
    assert.equal(count, 2);
    assert.equal(index.entryCount("s1"), 2);
  });

  it("respects maxEntriesPerSession cap", () => {
    const small = new TranscriptIndex(3);
    for (let i = 0; i < 10; i++) {
      small.append("s1", `plain text line ${i}`);
    }
    assert.equal(small.entryCount("s1"), 3);
  });
});

describe("TranscriptIndex — query", () => {
  let index;
  beforeEach(() => {
    index = new TranscriptIndex();
    index.appendBatch("s1", [
      "The authentication module was refactored",
      "Fixed a bug in the login handler",
      "Added new test cases for edge scenarios",
      "Updated dependencies for security patches",
      "Refactored the database connection pool",
    ]);
  });

  it("finds matching lines", () => {
    const hits = index.query("s1", "authentication");
    assert.ok(hits.length >= 1);
    assert.ok(hits[0].excerpt.toLowerCase().includes("authentication"));
  });

  it("returns empty for no matches", () => {
    const hits = index.query("s1", "xyznonexistent");
    assert.equal(hits.length, 0);
  });

  it("ranks by relevance", () => {
    const hits = index.query("s1", "refactored");
    assert.ok(hits.length >= 2);
    // Both "refactored" lines should have similar scores
    assert.ok(hits[0].score > 0);
  });

  it("supports prefix matching", () => {
    const hits = index.query("s1", "auth");
    assert.ok(hits.length >= 1, "Should find 'authentication' with prefix 'auth'");
  });

  it("returns sessionId in hits", () => {
    const hits = index.query("s1", "bug");
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].sessionId, "s1");
  });

  it("respects maxResults", () => {
    const hits = index.query("s1", "the", 2);
    assert.ok(hits.length <= 2);
  });

  it("returns line numbers", () => {
    const hits = index.query("s1", "login");
    assert.ok(hits.length >= 1);
    assert.equal(typeof hits[0].line, "number");
  });
});

describe("TranscriptIndex — multi-session", () => {
  let index;
  beforeEach(() => {
    index = new TranscriptIndex();
    index.appendBatch("s1", ["Error in module A", "Warning in module B"]);
    index.appendBatch("s2", ["Error in module C", "Success in module D"]);
  });

  it("queries are session-scoped", () => {
    const hits = index.query("s1", "module");
    assert.equal(hits.length, 2);
    assert.ok(hits.every(h => h.sessionId === "s1"));
  });

  it("queryAll searches across all sessions", () => {
    const hits = index.queryAll("error");
    assert.ok(hits.length >= 2);
    const sessions = new Set(hits.map(h => h.sessionId));
    assert.equal(sessions.size, 2);
  });

  it("sessionIds returns all indexed sessions", () => {
    const ids = index.sessionIds();
    assert.ok(ids.includes("s1"));
    assert.ok(ids.includes("s2"));
  });

  it("clearSession removes one session", () => {
    index.clearSession("s1");
    assert.equal(index.entryCount("s1"), 0);
    assert.ok(index.entryCount("s2") > 0);
  });

  it("clearAll removes everything", () => {
    index.clearAll();
    assert.equal(index.sessionIds().length, 0);
  });
});

describe("TranscriptIndex — NDJSON integration", () => {
  let index;
  beforeEach(() => { index = new TranscriptIndex(); });

  it("indexes tool names from tool_use events", () => {
    const json = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "blast_radius" },
    });
    index.append("s1", json);
    const hits = index.query("s1", "blast_radius");
    assert.ok(hits.length >= 1);
  });

  it("indexes result text", () => {
    const json = JSON.stringify({ type: "result", result: "All 15 tests passed successfully" });
    index.append("s1", json);
    const hits = index.query("s1", "tests passed");
    assert.ok(hits.length >= 1);
  });

  it("does NOT index input_json_delta", () => {
    const json = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: '{"query": "secret"}' },
    });
    index.append("s1", json);
    const hits = index.query("s1", "secret");
    assert.equal(hits.length, 0);
  });
});
