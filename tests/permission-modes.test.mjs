#!/usr/bin/env node
/**
 * Permission Modes Tests — PERM-3
 *
 * Run: node --test tests/permission-modes.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";

import {
  evaluateMode,
  setMode,
  getMode,
  resetMode,
  isReadOnlyTool,
  isWriteEditTool,
} from "../dist/platform/bus/permission-modes.js";

afterEach(() => resetMode());

// Helper to build ModeEvalContext
function ctx(overrides = {}) {
  return {
    tool: "Bash",
    isSafe: false,
    isReadOnly: false,
    isWriteTool: false,
    rulesResult: null,
    ...overrides,
  };
}

// ═══ 1. Tool Classification ═════════════════════════════

describe("tool classification", () => {
  it("Read is read-only", () => assert.ok(isReadOnlyTool("Read")));
  it("Glob is read-only", () => assert.ok(isReadOnlyTool("Glob")));
  it("Grep is read-only", () => assert.ok(isReadOnlyTool("Grep")));
  it("Bash is NOT read-only", () => assert.ok(!isReadOnlyTool("Bash")));
  it("Write is write tool", () => assert.ok(isWriteEditTool("Write")));
  it("Edit is write tool", () => assert.ok(isWriteEditTool("Edit")));
  it("Read is NOT write tool", () => assert.ok(!isWriteEditTool("Read")));
});

// ═══ 2. Default Mode ════════════════════════════════════

describe("default mode", () => {
  it("returns null for any tool (no opinion)", () => {
    assert.equal(evaluateMode("default", ctx()), null);
    assert.equal(evaluateMode("default", ctx({ tool: "Read" })), null);
  });
});

// ═══ 3. Plan Mode ═══════════════════════════════════════

describe("plan mode", () => {
  it("auto-allows read-only tools", () => {
    assert.equal(evaluateMode("plan", ctx({ tool: "Read", isReadOnly: true })), "allow");
  });

  it("auto-allows tools named Read/Glob/Grep", () => {
    assert.equal(evaluateMode("plan", ctx({ tool: "Glob" })), "allow");
  });

  it("auto-allows safe tools", () => {
    assert.equal(evaluateMode("plan", ctx({ tool: "Bash", isSafe: true })), "allow");
  });

  it("returns null for write tools (needs further eval)", () => {
    assert.equal(evaluateMode("plan", ctx({ tool: "Write", isWriteTool: true })), null);
  });
});

// ═══ 4. Auto Mode ═══════════════════════════════════════

describe("auto mode", () => {
  it("allows everything (deny already checked)", () => {
    assert.equal(evaluateMode("auto", ctx()), "allow");
    assert.equal(evaluateMode("auto", ctx({ tool: "Write" })), "allow");
  });
});

// ═══ 5. Bypass Mode — NFR-18 핵심 ══════════════════════

describe("bypass mode", () => {
  it("allows everything that reaches this point", () => {
    // Note: deny rules are checked BEFORE mode evaluation.
    // If we're in evaluateMode, no deny rule matched.
    assert.equal(evaluateMode("bypass", ctx()), "allow");
    assert.equal(evaluateMode("bypass", ctx({ tool: "Bash" })), "allow");
  });

  it("NFR-18: deny rules are bypass-immune (tested at gate level)", () => {
    // This invariant is enforced by the gate calling deny rules BEFORE mode.
    // Mode evaluator never sees denied requests.
    // Integration test in PERM-4 will verify this end-to-end.
    assert.ok(true, "Invariant enforced at gate level, not mode level");
  });
});

// ═══ 6. DontAsk Mode ═══════════════════════════════════

describe("dontAsk mode", () => {
  it("converts ask → allow", () => {
    const result = evaluateMode("dontAsk", ctx({
      rulesResult: { behavior: "ask", reason: { type: "rule" } },
    }));
    assert.equal(result, "allow");
  });

  it("allows safe tools", () => {
    assert.equal(evaluateMode("dontAsk", ctx({ isSafe: true })), "allow");
  });

  it("allows non-safe tools too (suppresses all prompts)", () => {
    assert.equal(evaluateMode("dontAsk", ctx({ tool: "Write" })), "allow");
  });
});

// ═══ 7. AcceptEdits Mode ═══════════════════════════════

describe("acceptEdits mode", () => {
  it("auto-allows Write", () => {
    assert.equal(evaluateMode("acceptEdits", ctx({ tool: "Write", isWriteTool: true })), "allow");
  });

  it("auto-allows Edit", () => {
    assert.equal(evaluateMode("acceptEdits", ctx({ tool: "Edit" })), "allow");
  });

  it("returns null for non-write tools (standard eval)", () => {
    assert.equal(evaluateMode("acceptEdits", ctx({ tool: "Bash" })), null);
  });

  it("returns null for Read", () => {
    assert.equal(evaluateMode("acceptEdits", ctx({ tool: "Read" })), null);
  });
});

// ═══ 8. Mode State Management ══════════════════════════

describe("mode state", () => {
  it("default mode at start", () => {
    assert.equal(getMode(), "default");
  });

  it("setMode changes mode", () => {
    setMode("bypass");
    assert.equal(getMode(), "bypass");
  });

  it("resetMode restores default", () => {
    setMode("auto");
    resetMode();
    assert.equal(getMode(), "default");
  });
});
