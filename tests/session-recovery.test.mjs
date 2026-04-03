#!/usr/bin/env node
/**
 * Session Recovery Tests — ERROR-4
 *
 * Run: node --test tests/session-recovery.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectSessionCrash,
  buildContinuation,
} from "../dist/platform/core/session-recovery.js";

// ═══ 1. detectSessionCrash ══════════════════════════════

describe("detectSessionCrash", () => {
  it("empty messages → none", () => {
    assert.equal(detectSessionCrash([]).kind, "none");
  });

  it("normal completion → none", () => {
    const result = detectSessionCrash([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", complete: true },
    ]);
    assert.equal(result.kind, "none");
  });

  it("incomplete assistant → interrupted_turn", () => {
    const result = detectSessionCrash([
      { role: "user", content: "hello" },
      { role: "assistant", content: "I was saying..." },
    ]);
    assert.equal(result.kind, "interrupted_turn");
    assert.equal(result.partialContent, "I was saying...");
  });

  it("user message with no response → interrupted_prompt", () => {
    const result = detectSessionCrash([
      { role: "assistant", content: "done", complete: true },
      { role: "user", content: "do something" },
    ]);
    assert.equal(result.kind, "interrupted_prompt");
  });

  it("tool_result as last → interrupted_turn", () => {
    const result = detectSessionCrash([
      { role: "user", content: "run" },
      { role: "assistant", content: "running..." },
      { role: "tool_result", content: "output" },
    ]);
    assert.equal(result.kind, "interrupted_turn");
  });

  it("system message as last → none", () => {
    const result = detectSessionCrash([
      { role: "system", content: "system init" },
    ]);
    assert.equal(result.kind, "none");
  });

  it("lastCompleteIndex is correct", () => {
    const result = detectSessionCrash([
      { role: "user", content: "a" },
      { role: "assistant", content: "b", complete: true },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" }, // incomplete
    ]);
    assert.equal(result.kind, "interrupted_turn");
    assert.equal(result.lastCompleteIndex, 2); // index of "c"
  });
});

// ═══ 2. buildContinuation ═══════════════════════════════

describe("buildContinuation", () => {
  it("none → empty string", () => {
    const result = buildContinuation(
      { kind: "none", lastCompleteIndex: 0 },
      [],
    );
    assert.equal(result, "");
  });

  it("interrupted_turn includes partial content", () => {
    const result = buildContinuation(
      { kind: "interrupted_turn", lastCompleteIndex: 0, partialContent: "I was doing..." },
      [{ role: "assistant", content: "I was doing..." }],
    );
    assert.ok(result.includes("[SESSION RECOVERY]"));
    assert.ok(result.includes("interrupted"));
    assert.ok(result.includes("I was doing..."));
  });

  it("interrupted_prompt includes last user message", () => {
    const messages = [
      { role: "user", content: "implement the auth module" },
    ];
    const result = buildContinuation(
      { kind: "interrupted_prompt", lastCompleteIndex: -1 },
      messages,
    );
    assert.ok(result.includes("implement the auth module"));
  });

  it("includes wave state when provided", () => {
    const result = buildContinuation(
      { kind: "interrupted_turn", lastCompleteIndex: 0 },
      [{ role: "assistant", content: "working..." }],
      {
        completedIds: ["WB-1", "WB-2"],
        failedIds: ["WB-3"],
        lastCompletedWave: 2,
        totalItems: 5,
        totalWaves: 3,
        lastFitness: 0.85,
      },
    );
    assert.ok(result.includes("Completed: 2/5"));
    assert.ok(result.includes("Failed: 1"));
    assert.ok(result.includes("WB-3"));
    assert.ok(result.includes("0.85"));
  });

  it("truncates long content", () => {
    const longContent = "x".repeat(500);
    const result = buildContinuation(
      { kind: "interrupted_turn", lastCompleteIndex: 0, partialContent: longContent },
      [{ role: "assistant", content: longContent }],
    );
    assert.ok(result.includes("..."));
    assert.ok(result.length < longContent.length + 500);
  });
});
