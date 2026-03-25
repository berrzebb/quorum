/**
 * MuxAuditor integration tests — real terminal output parsing.
 * Tests isComplete, extractAssistantText, buildArgs, parseAuditOutput
 * with actual capture-pane output samples (no mocks).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isComplete, extractAssistantText, buildArgs, parseAuditOutput } from "../dist/providers/auditors/mux.js";

// ── Fixtures: actual capture-pane output samples ──────────

// Claude stream-json with SessionStart hook + actual result (terminal-wrapped at ~120 cols)
const CLAUDE_FULL_OUTPUT = [
  '{"type":"system","subtype":"hook_response","hook_id":"abc","hook_name":"SessionStart:startup","output":"{\\"additionalContext\\": \\"[quorum]\\\\n\\\\nconfig.json\\","stdout":"{\\"additionalContext\\": \\"ok\\"}","stderr":"","exit_code":0,"outcome":"success","uuid":"123","session_id":"sess-1","stop_reason":null}',
  '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"verdict\\": \\"chan'
    + 'ges_requested\\", \\"reasoning\\": \\"Missing tests\\", \\"codes\\": [\\"NO_TESTS\\"], \\"confidence\\": 0.85, \\"items\\": [{\\"description\\": \\"No unit tests\\", \\"type\\": \\"gap\\"}]}"}}',
  '{"type":"content_block_stop","index":0}',
  '{"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":5000,"result":"{\\"verdict\\": \\"changes_requested\\", \\"reasoning\\": \\"Missing tests\\", \\"codes\\": [\\"NO_TESTS\\"], \\"confidence\\": 0.85, \\"items\\": [{\\"description\\": \\"No unit tests\\", \\"type\\": \\"gap\\"}]}","stop_reason":"end_turn","session_id":"sess-1"}'
].join("\n");

// Same but terminal-wrapped (lines broken at column 80, padded with spaces like capture-pane)
const CLAUDE_WRAPPED = CLAUDE_FULL_OUTPUT.replace(/(.{80})/g, "$1" + " ".repeat(40) + "\n");

// Hook response with nested "stop_reason" that should NOT trigger isComplete
const HOOK_ONLY_OUTPUT = [
  '{"type":"system","subtype":"hook_response","hook_name":"SessionStart","output":"{\\"stop_reason\\":null,\\"session_id\\":\\"x\\"}","stderr":"","exit_code":0,"outcome":"success","uuid":"u1","session_id":"s1"}',
  '{"type":"system","subtype":"hook_response","hook_name":"SessionStart:startup","output":"{\\"additionalContext\\":\\"ok\\"}","stderr":"","exit_code":0}',
].join("\n");

// Output with ANSI escape codes
const ANSI_OUTPUT = [
  '\x1b[36m{"type":"content_block_delta","delta":{"text":"hello"}}\x1b[0m',
  '\x1b[1m{"type":"result","subtype":"success","result":"world","session_id":"s1"}\x1b[0m',
].join("\n");

// ── Tests ─────────────────────────────────────

describe("isComplete", () => {
  it("detects claude result event", () => {
    assert.equal(isComplete(CLAUDE_FULL_OUTPUT, "claude"), true);
  });

  it("detects claude result in wrapped output", () => {
    assert.equal(isComplete(CLAUDE_WRAPPED, "claude"), true);
  });

  it("does NOT trigger on hook response with nested stop_reason", () => {
    assert.equal(isComplete(HOOK_ONLY_OUTPUT, "claude"), false);
  });

  it("returns false on empty output", () => {
    assert.equal(isComplete("", "claude"), false);
  });

  it("detects codex turn.completed", () => {
    const codexOutput = '{"type":"turn.completed","turns":1}';
    assert.equal(isComplete(codexOutput, "codex"), true);
  });

  it("handles ANSI codes in output", () => {
    assert.equal(isComplete(ANSI_OUTPUT, "claude"), true);
  });
});

describe("extractAssistantText", () => {
  it("extracts result text from full stream-json", () => {
    const text = extractAssistantText(CLAUDE_FULL_OUTPUT);
    assert.ok(text);
    assert.ok(text.includes("verdict"));
    assert.ok(text.includes("changes_requested"));
  });

  it("extracts from terminal-wrapped output", () => {
    const text = extractAssistantText(CLAUDE_WRAPPED);
    assert.ok(text);
    assert.ok(text.includes("Missing tests"));
  });

  it("strips ANSI codes before parsing", () => {
    const text = extractAssistantText(ANSI_OUTPUT);
    assert.ok(text);
    // result event has "world", extractAssistantText prefers result over delta
    assert.ok(text === "world" || text === "hello", `Expected 'world' or 'hello', got '${text}'`);
  });

  it("returns null for hook-only output", () => {
    const text = extractAssistantText(HOOK_ONLY_OUTPUT);
    assert.equal(text, null);
  });

  it("returns null for empty input", () => {
    assert.equal(extractAssistantText(""), null);
  });

  it("assembles from content_block_delta when no result event", () => {
    const deltaOnly = [
      '{"type":"content_block_delta","delta":{"text":"part1"}}',
      '{"type":"content_block_delta","delta":{"text":"part2"}}',
    ].join("\n");
    const text = extractAssistantText(deltaOnly);
    assert.equal(text, "part1part2");
  });
});

describe("buildArgs", () => {
  it("claude: includes -p, stream-json, dangerously-skip-permissions", () => {
    const args = buildArgs("claude");
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("--output-format"));
    assert.ok(args.includes("stream-json"));
    assert.ok(args.includes("--dangerously-skip-permissions"));
  });

  it("claude: includes model when specified", () => {
    const args = buildArgs("claude", "claude-opus-4-6");
    assert.ok(args.includes("--model"));
    assert.ok(args.includes("claude-opus-4-6"));
  });

  it("codex: includes --full-auto", () => {
    const args = buildArgs("codex");
    assert.ok(args.includes("--full-auto"));
    assert.ok(args.includes("exec"));
    assert.ok(args.includes("--json"));
  });

  it("gemini: no permission flag needed", () => {
    const args = buildArgs("gemini");
    assert.ok(args.includes("-p"));
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    assert.ok(!args.includes("--full-auto"));
  });
});

describe("parseAuditOutput", () => {
  it("extracts verdict from stream-json output", () => {
    const result = parseAuditOutput(CLAUDE_FULL_OUTPUT, 5000);
    assert.equal(result.verdict, "changes_requested");
    assert.ok(result.codes.includes("NO_TESTS"));
    assert.ok(result.summary.includes("Missing tests"));
  });

  it("extracts from terminal-wrapped output", () => {
    const result = parseAuditOutput(CLAUDE_WRAPPED, 5000);
    assert.equal(result.verdict, "changes_requested");
  });

  it("returns parse-error or changes_requested on hook-only output (no verdict)", () => {
    const result = parseAuditOutput(HOOK_ONLY_OUTPUT, 1000);
    // Hook output has no verdict JSON — should NOT return approved
    assert.notEqual(result.verdict, "approved");
  });

  it("returns parse-error on empty output", () => {
    const result = parseAuditOutput("", 100);
    assert.ok(result.codes.includes("parse-error"));
  });
});
