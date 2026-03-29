#!/usr/bin/env node
/**
 * DUX-10: AgentChatPanel split — structural contracts.
 *
 * Verifies 7 extracted panel files exist, exports are correct,
 * and transcript-selection utilities work as specified.
 *
 * Run: node --test tests/daemon-chat-split.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SESSIONS_DIR = resolve("daemon", "panels", "sessions");

// ═══ 1. File existence ═══════════════════════════════════════════════

describe("DUX-10: file existence", () => {
  const expectedFiles = [
    "session-list.tsx",
    "transcript-pane.tsx",
    "transcript-selection.ts",
    "composer.tsx",
    "git-sidebar.tsx",
    "commit-graph.tsx",
    "changed-files.tsx",
  ];

  for (const file of expectedFiles) {
    it(`daemon/panels/sessions/${file} exists`, () => {
      const fullPath = resolve(SESSIONS_DIR, file);
      assert.ok(existsSync(fullPath), `Missing: ${file}`);
    });
  }

  it("at least 7 files in daemon/panels/sessions/", () => {
    const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
    assert.ok(files.length >= 7, `Expected >= 7 files, got ${files.length}: ${files.join(", ")}`);
  });
});

// ═══ 2. TranscriptSelection contract ═════════════════════════════════

describe("DUX-10: TranscriptSelection", () => {
  let createSelection;
  let clearSelection;

  it("transcript-selection.ts compiles and exports createSelection + clearSelection", async () => {
    const mod = await import("../dist/daemon/panels/sessions/transcript-selection.js");
    assert.equal(typeof mod.createSelection, "function", "createSelection should be a function");
    assert.equal(typeof mod.clearSelection, "function", "clearSelection should be a function");
    createSelection = mod.createSelection;
    clearSelection = mod.clearSelection;
  });

  it("createSelection returns correct selection from line array", async () => {
    if (!createSelection) {
      const mod = await import("../dist/daemon/panels/sessions/transcript-selection.js");
      createSelection = mod.createSelection;
    }
    const lines = ["line 0", "line 1", "line 2", "line 3", "line 4"];
    const sel = createSelection(lines, 1, 3);
    assert.equal(sel.startLine, 1);
    assert.equal(sel.endLine, 3);
    assert.equal(sel.text, "line 1\nline 2\nline 3");
  });

  it("createSelection handles reversed start/end", async () => {
    if (!createSelection) {
      const mod = await import("../dist/daemon/panels/sessions/transcript-selection.js");
      createSelection = mod.createSelection;
    }
    const lines = ["a", "b", "c", "d", "e"];
    const sel = createSelection(lines, 4, 2);
    assert.equal(sel.startLine, 2);
    assert.equal(sel.endLine, 4);
    assert.equal(sel.text, "c\nd\ne");
  });

  it("createSelection handles single line selection", async () => {
    if (!createSelection) {
      const mod = await import("../dist/daemon/panels/sessions/transcript-selection.js");
      createSelection = mod.createSelection;
    }
    const lines = ["only", "two", "lines"];
    const sel = createSelection(lines, 1, 1);
    assert.equal(sel.startLine, 1);
    assert.equal(sel.endLine, 1);
    assert.equal(sel.text, "two");
  });

  it("TranscriptSelection type has startLine, endLine, text fields", async () => {
    if (!createSelection) {
      const mod = await import("../dist/daemon/panels/sessions/transcript-selection.js");
      createSelection = mod.createSelection;
    }
    const sel = createSelection(["a", "b"], 0, 1);
    assert.ok("startLine" in sel, "Missing startLine");
    assert.ok("endLine" in sel, "Missing endLine");
    assert.ok("text" in sel, "Missing text");
    assert.equal(typeof sel.startLine, "number");
    assert.equal(typeof sel.endLine, "number");
    assert.equal(typeof sel.text, "string");
  });

  it("clearSelection returns null", async () => {
    if (!clearSelection) {
      const mod = await import("../dist/daemon/panels/sessions/transcript-selection.js");
      clearSelection = mod.clearSelection;
    }
    assert.equal(clearSelection(), null);
  });
});

// ═══ 3. Named exports from panel files ═══════════════════════════════

describe("DUX-10: named exports", () => {
  it("session-list.tsx exports SessionList function", async () => {
    const mod = await import("../dist/daemon/panels/sessions/session-list.js");
    assert.equal(typeof mod.SessionList, "function", "SessionList should be a function");
  });

  it("transcript-pane.tsx exports TranscriptPane function", async () => {
    const mod = await import("../dist/daemon/panels/sessions/transcript-pane.js");
    assert.equal(typeof mod.TranscriptPane, "function", "TranscriptPane should be a function");
  });

  it("transcript-pane.tsx exports parseStreamJson function", async () => {
    const mod = await import("../dist/daemon/panels/sessions/transcript-pane.js");
    assert.equal(typeof mod.parseStreamJson, "function", "parseStreamJson should be a function");
  });

  it("composer.tsx exports Composer function", async () => {
    const mod = await import("../dist/daemon/panels/sessions/composer.js");
    assert.equal(typeof mod.Composer, "function", "Composer should be a function");
  });

  it("git-sidebar.tsx exports GitSidebar function", async () => {
    const mod = await import("../dist/daemon/panels/sessions/git-sidebar.js");
    assert.equal(typeof mod.GitSidebar, "function", "GitSidebar should be a function");
  });

  it("commit-graph.tsx exports CommitGraph function", async () => {
    const mod = await import("../dist/daemon/panels/sessions/commit-graph.js");
    assert.equal(typeof mod.CommitGraph, "function", "CommitGraph should be a function");
  });

  it("changed-files.tsx exports ChangedFiles function", async () => {
    const mod = await import("../dist/daemon/panels/sessions/changed-files.js");
    assert.equal(typeof mod.ChangedFiles, "function", "ChangedFiles should be a function");
  });
});

// ═══ 4. parseStreamJson utility ══════════════════════════════════════

describe("DUX-10: parseStreamJson", () => {
  let parseStreamJson;

  it("parseStreamJson parses content_block_delta messages", async () => {
    const mod = await import("../dist/daemon/panels/sessions/transcript-pane.js");
    parseStreamJson = mod.parseStreamJson;

    const raw = [
      '{"type":"content_block_delta","delta":{"text":"Hello "}}',
      '{"type":"content_block_delta","delta":{"text":"world"}}',
    ];
    const result = parseStreamJson(raw);
    assert.ok(result.length > 0, "Should produce output");
    const joined = result.join("\n");
    assert.ok(joined.includes("Hello"), "Should contain 'Hello'");
    assert.ok(joined.includes("world"), "Should contain 'world'");
  });

  it("parseStreamJson falls back to raw lines for non-JSON input", async () => {
    if (!parseStreamJson) {
      const mod = await import("../dist/daemon/panels/sessions/transcript-pane.js");
      parseStreamJson = mod.parseStreamJson;
    }
    const raw = ["plain text line 1", "plain text line 2"];
    const result = parseStreamJson(raw);
    assert.deepEqual(result, raw);
  });

  it("parseStreamJson handles user messages", async () => {
    if (!parseStreamJson) {
      const mod = await import("../dist/daemon/panels/sessions/transcript-pane.js");
      parseStreamJson = mod.parseStreamJson;
    }
    const raw = [
      '{"type":"message","role":"user","content":"hello"}',
      '{"type":"content_block_delta","delta":{"text":"response"}}',
    ];
    const result = parseStreamJson(raw);
    const joined = result.join("\n");
    assert.ok(joined.includes("USER"), "Should mark user messages");
    assert.ok(joined.includes("hello"), "Should contain user text");
    assert.ok(joined.includes("response"), "Should contain assistant text");
  });
});

// ═══ 5. Original AgentChatPanel preserved ════════════════════════════

describe("DUX-10: original preserved", () => {
  it("daemon/components/AgentChatPanel.tsx still exists", () => {
    assert.ok(
      existsSync(resolve("daemon", "components", "AgentChatPanel.tsx")),
      "Original AgentChatPanel.tsx must not be deleted",
    );
  });

  it("original AgentChatPanel.tsx still exports AgentChatPanel", () => {
    const content = readFileSync(resolve("daemon", "components", "AgentChatPanel.tsx"), "utf8");
    assert.ok(
      content.includes("export function AgentChatPanel"),
      "Original must still export AgentChatPanel function",
    );
  });

  it("original AgentChatPanel.tsx > 300 lines (unmodified)", () => {
    const content = readFileSync(resolve("daemon", "components", "AgentChatPanel.tsx"), "utf8");
    const lines = content.split("\n").length;
    assert.ok(lines > 300, `AgentChatPanel.tsx has ${lines} lines, expected > 300`);
  });
});
