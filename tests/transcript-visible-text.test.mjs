#!/usr/bin/env node
/**
 * RTI-3A: Visible-Text Extraction Contract Tests
 *
 * Core contract: "search indexes only user-visible text."
 * System reminders, hidden XML tags, raw JSON metadata, and tool input
 * MUST NOT appear in visible text extraction.
 *
 * Run: node --test tests/transcript-visible-text.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  classifyLine,
  extractVisibleText,
  isHiddenContent,
} = await import("../dist/platform/bus/transcript-index.js");

// ═══ 1. System Reminders = Hidden ═══════════════════════════════════════

describe("System reminders are hidden", () => {
  it("<system-reminder> tags are hidden", () => {
    const result = classifyLine("<system-reminder>Some internal context</system-reminder>", 0);
    assert.equal(result.visibility, "hidden");
  });

  it("<system-reminder> opening tag is hidden", () => {
    const result = classifyLine("<system-reminder>", 0);
    assert.equal(result.visibility, "hidden");
  });

  it("</system-reminder> closing tag is hidden", () => {
    const result = classifyLine("</system-reminder>", 0);
    assert.equal(result.visibility, "hidden");
  });

  it("<task-notification> tags are hidden", () => {
    const result = classifyLine("<task-notification>", 0);
    assert.equal(result.visibility, "hidden");
  });

  it("<local-command-caveat> tags are hidden", () => {
    const result = classifyLine("<local-command-caveat>Some caveat</local-command-caveat>", 0);
    assert.equal(result.visibility, "hidden");
  });
});

// ═══ 2. User/Assistant Text = Visible ═══════════════════════════════════

describe("User and assistant text is visible", () => {
  it("user message JSON is visible", () => {
    const json = JSON.stringify({ type: "message", role: "user", content: "Hello world" });
    const result = classifyLine(json, 0);
    assert.equal(result.visibility, "visible");
    assert.equal(result.section, "user");
    assert.ok(result.text.includes("Hello world"));
  });

  it("assistant text_delta is visible", () => {
    const json = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Here is my response" },
    });
    const result = classifyLine(json, 0);
    assert.equal(result.visibility, "visible");
    assert.equal(result.section, "assistant");
    assert.ok(result.text.includes("Here is my response"));
  });

  it("thinking_delta is visible", () => {
    const json = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "thinking_delta", thinking: "Let me think about this..." },
    });
    const result = classifyLine(json, 0);
    assert.equal(result.visibility, "visible");
    assert.equal(result.section, "thinking");
  });

  it("tool_use block start is visible", () => {
    const json = JSON.stringify({
      type: "content_block_start",
      content_block: { type: "tool_use", name: "code_map" },
    });
    const result = classifyLine(json, 0);
    assert.equal(result.visibility, "visible");
    assert.equal(result.section, "tool");
    assert.ok(result.text.includes("code_map"));
  });

  it("final result is visible", () => {
    const json = JSON.stringify({ type: "result", result: "Task completed successfully." });
    const result = classifyLine(json, 0);
    assert.equal(result.visibility, "visible");
    assert.equal(result.section, "assistant");
  });
});

// ═══ 3. Hidden Content Types ════════════════════════════════════════════

describe("Hidden content types", () => {
  it("input_json_delta is hidden (tool input JSON)", () => {
    const json = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: '{"query": "test' },
    });
    const result = classifyLine(json, 0);
    assert.equal(result.visibility, "hidden");
  });

  it("metadata-only JSON is hidden", () => {
    const json = JSON.stringify({ id: "msg_123", model: "claude-opus", usage: { input_tokens: 100 } });
    const result = classifyLine(json, 0);
    assert.equal(result.visibility, "metadata");
  });

  it("malformed JSON is hidden", () => {
    const result = classifyLine("{broken json here", 0);
    assert.equal(result.visibility, "hidden");
  });
});

// ═══ 4. extractVisibleText ══════════════════════════════════════════════

describe("extractVisibleText — full transcript extraction", () => {
  it("extracts only visible text from mixed transcript", () => {
    const rawLines = [
      '<system-reminder>You are Claude Code</system-reminder>',
      JSON.stringify({ type: "message", role: "user", content: "Hello" }),
      JSON.stringify({ type: "content_block_start", content_block: { type: "text" } }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hi there!" } }),
      JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{}' } }),
      JSON.stringify({ id: "msg_1", model: "claude", usage: { input_tokens: 50 } }),
      '<task-notification>task done</task-notification>',
    ];

    const visible = extractVisibleText(rawLines);

    // Should include user message and assistant text
    assert.ok(visible.some(l => l.includes("Hello")), "Should include user text");
    assert.ok(visible.some(l => l.includes("Hi there!")), "Should include assistant text");

    // Should NOT include hidden content
    const joined = visible.join("\n");
    assert.ok(!joined.includes("system-reminder"), "Should not include system reminders");
    assert.ok(!joined.includes("task-notification"), "Should not include task notifications");
    assert.ok(!joined.includes("input_json_delta"), "Should not include tool input JSON");
    assert.ok(!joined.includes("msg_1"), "Should not include metadata");
  });

  it("returns empty array for all-hidden transcript", () => {
    const rawLines = [
      '<system-reminder>hidden</system-reminder>',
      JSON.stringify({ id: "x", model: "y", usage: {} }),
    ];
    const visible = extractVisibleText(rawLines);
    assert.equal(visible.length, 0);
  });

  it("plain text lines are visible", () => {
    const rawLines = ["This is plain text", "Another line"];
    const visible = extractVisibleText(rawLines);
    assert.ok(visible.includes("This is plain text"));
    assert.ok(visible.includes("Another line"));
  });
});

// ═══ 5. isHiddenContent ═════════════════════════════════════════════════

describe("isHiddenContent helper", () => {
  it("detects system-reminder", () => {
    assert.equal(isHiddenContent("<system-reminder>foo</system-reminder>"), true);
  });

  it("detects task-notification", () => {
    assert.equal(isHiddenContent("<task-notification>"), true);
  });

  it("plain text is not hidden", () => {
    assert.equal(isHiddenContent("Hello world"), false);
  });

  it("JSON is not hidden by pattern (handled separately)", () => {
    assert.equal(isHiddenContent('{"type":"message"}'), false);
  });
});

// ═══ 6. Section Detection ═══════════════════════════════════════════════

describe("Section detection", () => {
  it("user message → section: user", () => {
    const json = JSON.stringify({ type: "message", role: "user", content: "test" });
    assert.equal(classifyLine(json, 0).section, "user");
  });

  it("text delta → section: assistant", () => {
    const json = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } });
    assert.equal(classifyLine(json, 0).section, "assistant");
  });

  it("thinking delta → section: thinking", () => {
    const json = JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "x" } });
    assert.equal(classifyLine(json, 0).section, "thinking");
  });

  it("tool_use start → section: tool", () => {
    const json = JSON.stringify({ type: "content_block_start", content_block: { type: "tool_use", name: "t" } });
    assert.equal(classifyLine(json, 0).section, "tool");
  });

  it("tool_result → section: result", () => {
    const json = JSON.stringify({ type: "tool_result", content: "ok" });
    assert.equal(classifyLine(json, 0).section, "result");
  });
});
