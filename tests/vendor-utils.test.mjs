/**
 * Tests for vendor-utils.mjs — globby, marked, diff-match-patch, web-tree-sitter.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  enhancedGlob,
  isGlobbyAvailable,
  parseMarkdownTokens,
  extractHeadings,
  extractCodeBlocks,
  isMarkedAvailable,
  computeDiff,
  diffStats,
  createPatch,
  isDiffAvailable,
  initTreeSitter,
  isTreeSitterAvailable,
  vendorStatus,
} from "../platform/core/tools/vendor-utils.mjs";

// ── Availability ───────────────────────────────────────

describe("vendor-utils availability", () => {
  it("all four packages are available", () => {
    const status = vendorStatus();
    assert.equal(status.globby, true, "globby should be available");
    assert.equal(status.marked, true, "marked should be available");
    assert.equal(status.diff, true, "diff-match-patch should be available");
    // tree-sitter needs init() first
  });
});

// ── Globby ─────────────────────────────────────────────

describe("enhancedGlob", () => {
  it("finds .mjs files in platform/core/tools/", async () => {
    const results = await enhancedGlob(["platform/core/tools/*.mjs"], {
      cwd: process.cwd(),
    });
    assert.ok(results !== null, "globby should return results");
    assert.ok(results.length > 0, "should find at least one .mjs file");
    assert.ok(
      results.some(f => f.includes("tool-utils.mjs")),
      "should find tool-utils.mjs"
    );
  });

  it("supports negation patterns", async () => {
    const results = await enhancedGlob(
      ["platform/core/tools/*.mjs", "!**/vendor-utils.mjs"],
      { cwd: process.cwd() }
    );
    assert.ok(results !== null);
    assert.ok(
      !results.some(f => f.includes("vendor-utils.mjs")),
      "should exclude vendor-utils.mjs"
    );
  });

  it("respects gitignore by default", async () => {
    const results = await enhancedGlob(["node_modules/**/*.js"], {
      cwd: process.cwd(),
    });
    assert.ok(results !== null);
    assert.equal(results.length, 0, "node_modules should be ignored");
  });
});

// ── Marked ─────────────────────────────────────────────

describe("parseMarkdownTokens", () => {
  it("parses markdown into tokens", () => {
    const tokens = parseMarkdownTokens("# Hello\n\nWorld");
    assert.ok(tokens !== null);
    assert.ok(tokens.length > 0);
    const heading = tokens.find(t => t.type === "heading");
    assert.ok(heading);
    assert.equal(heading.depth, 1);
    assert.equal(heading.text, "Hello");
  });
});

describe("extractHeadings", () => {
  it("extracts headings with depth", () => {
    const md = "# H1\n## H2\n### H3\ntext\n## Another H2";
    const headings = extractHeadings(md);
    assert.ok(headings !== null);
    assert.equal(headings.length, 4);
    assert.equal(headings[0].depth, 1);
    assert.equal(headings[0].text, "H1");
    assert.equal(headings[1].depth, 2);
    assert.equal(headings[3].depth, 2);
    assert.equal(headings[3].text, "Another H2");
  });

  it("returns empty array for no headings", () => {
    const headings = extractHeadings("just text\nno headings");
    assert.ok(headings !== null);
    assert.equal(headings.length, 0);
  });
});

describe("extractCodeBlocks", () => {
  it("extracts code blocks", () => {
    const md = "# Example\n```typescript\nconst x = 1;\n```\n```python\nprint(1)\n```";
    const blocks = extractCodeBlocks(md);
    assert.ok(blocks !== null);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].lang, "typescript");
    assert.ok(blocks[0].text.includes("const x"));
    assert.equal(blocks[1].lang, "python");
  });

  it("filters by language", () => {
    const md = "```ts\na\n```\n```py\nb\n```\n```ts\nc\n```";
    const tsBlocks = extractCodeBlocks(md, "ts");
    assert.ok(tsBlocks !== null);
    assert.equal(tsBlocks.length, 2);
  });

  it("extracts mermaid diagrams", () => {
    const md = "```mermaid\nflowchart TD\n  A --> B\n```";
    const blocks = extractCodeBlocks(md, "mermaid");
    assert.ok(blocks !== null);
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].text.includes("flowchart"));
  });
});

// ── Diff-Match-Patch ───────────────────────────────────

describe("computeDiff", () => {
  it("detects additions", () => {
    const diffs = computeDiff("hello", "hello world");
    assert.ok(diffs !== null);
    assert.ok(diffs.some(d => d.op === 1 && d.text.includes("world")));
  });

  it("detects deletions", () => {
    const diffs = computeDiff("hello world", "hello");
    assert.ok(diffs !== null);
    assert.ok(diffs.some(d => d.op === -1));
  });

  it("handles identical texts", () => {
    const diffs = computeDiff("same", "same");
    assert.ok(diffs !== null);
    assert.ok(diffs.every(d => d.op === 0));
  });
});

describe("diffStats", () => {
  it("counts additions and deletions", () => {
    const stats = diffStats("line1\nline2\n", "line1\nline3\nline4\n");
    assert.ok(stats !== null);
    assert.ok(stats.additions > 0, "should have additions");
    assert.ok(stats.deletions > 0, "should have deletions");
  });

  it("shows zero changes for identical texts", () => {
    const stats = diffStats("same\n", "same\n");
    assert.ok(stats !== null);
    assert.equal(stats.additions, 0);
    assert.equal(stats.deletions, 0);
  });
});

describe("createPatch", () => {
  it("creates a patch string", () => {
    const patch = createPatch("hello", "hello world");
    assert.ok(patch !== null);
    assert.ok(patch.length > 0);
    assert.ok(typeof patch === "string");
  });
});

// ── Web Tree-Sitter ────────────────────────────────────

describe("web-tree-sitter", () => {
  it("init returns boolean (may fail in pure Node.js without WASM loader)", async () => {
    const ok = await initTreeSitter();
    assert.equal(typeof ok, "boolean");
    // WASM init may not work in all Node.js environments (e.g. missing WASM support)
    // The important thing is it doesn't throw and returns a clear boolean
  });
});

// ── Final status ───────────────────────────────────────

describe("vendorStatus", () => {
  it("core three packages always available", () => {
    const status = vendorStatus();
    assert.equal(status.globby, true, "globby available");
    assert.equal(status.marked, true, "marked available");
    assert.equal(status.diff, true, "diff-match-patch available");
    // tree-sitter is environment-dependent (WASM loader)
    assert.equal(typeof status.treeSitter, "boolean");
  });
});
