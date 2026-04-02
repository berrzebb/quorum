#!/usr/bin/env node
/**
 * Hybrid Scan Tests — Regex + AST refinement integration.
 *
 * Verifies that runPatternScan with astRefine callback correctly:
 *   1. Removes false positives (patterns in comments/strings)
 *   2. Downgrades while(true) with break/return to non-high
 *   3. Falls back to regex-only when AST is unavailable
 *
 * Run: node --test tests/hybrid-scan.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const { runPatternScan } = await import("../platform/core/tools/tool-utils.mjs");
const { createAstRefineCallback, isAstAvailable, getAstLoadError } = await import("../platform/core/tools/ast-bridge.mjs");

if (!isAstAvailable()) {
  const err = getAstLoadError();
  console.log(`[hybrid-scan] AST unavailable${err ? `: ${err.message}` : " (dist/ not built)"} — tests will verify fail-open behavior`);
}

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hybrid-test-"));
});

after(() => {
  try {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) { console.warn("hybrid-scan cleanup failed:", err?.message ?? err); }
});

function writeFile(name, content) {
  const p = join(tmpDir, name);
  const dir = join(tmpDir, ...name.split("/").slice(0, -1));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, content, "utf8");
  return p;
}

const BUSY_LOOP_PATTERN = [
  { re: /while\s*\(\s*true\s*\)/m, label: "busy-loop", severity: "high", msg: "while(true) — potential busy loop" },
];

// ═══ 1. AST removes while(true) with break ══════════════════════════════

describe("hybrid: while(true) refinement", () => {
  it("keeps while(true) without break as HIGH", () => {
    writeFile("unsafe.ts", `
function spin() {
  while (true) {
    doWork();
  }
}
`);
    const astRefine = createAstRefineCallback(tmpDir);
    const result = runPatternScan({
      targetPath: tmpDir,
      extensions: new Set([".ts"]),
      patterns: BUSY_LOOP_PATTERN,
      toolName: "test",
      heading: "Test",
      passMsg: "clean",
      failNoun: "issue(s)",
      astRefine,
    });
    const findings = result.json?.findings || [];
    const busyLoop = findings.filter(f => f.label === "busy-loop");
    assert.equal(busyLoop.length, 1, "unsafe while(true) should remain");
  });

  it("removes while(true) with break via AST refinement", () => {
    // Clean tmpDir for isolation
    const subDir = join(tmpDir, "safe-test");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "safe.ts"), `
function poll() {
  while (true) {
    const msg = receive();
    if (msg === "done") break;
  }
}
`, "utf8");
    const astRefine = createAstRefineCallback(subDir);
    if (!astRefine) {
      // AST unavailable (dist/ not built or load error) — verify fail-open: regex finding remains
      const result = runPatternScan({
        targetPath: subDir, extensions: new Set([".ts"]), patterns: BUSY_LOOP_PATTERN,
        toolName: "test", heading: "Test", passMsg: "clean", failNoun: "issue(s)", astRefine,
      });
      assert.equal((result.json?.findings || []).length, 1, "without AST, regex finding should remain (fail-open)");
      return;
    }
    const result = runPatternScan({
      targetPath: subDir,
      extensions: new Set([".ts"]),
      patterns: BUSY_LOOP_PATTERN,
      toolName: "test",
      heading: "Test",
      passMsg: "clean",
      failNoun: "issue(s)",
      astRefine,
    });
    // AST should have removed the false positive
    const findings = result.json?.findings || [];
    const busyLoop = findings.filter(f => f.label === "busy-loop");
    assert.equal(busyLoop.length, 0, "safe while(true) with break should be removed by AST");
  });
});

// ═══ 2. AST removes comment false positive ══════════════════════════════

describe("hybrid: comment false positive", () => {
  it("removes while(true) pattern inside a comment", () => {
    const subDir = join(tmpDir, "comment-test");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "commented.ts"),
      "// while(true) is dangerous — but this is just a comment\nconst x = 1;\n", "utf8");
    const astRefine = createAstRefineCallback(subDir);
    if (!astRefine) {
      // AST unavailable — verify fail-open: regex finding remains
      const result = runPatternScan({
        targetPath: subDir, extensions: new Set([".ts"]), patterns: BUSY_LOOP_PATTERN,
        toolName: "test", heading: "Test", passMsg: "clean", failNoun: "issue(s)", astRefine,
      });
      assert.equal((result.json?.findings || []).length, 1, "without AST, comment match remains (fail-open)");
      return;
    }
    const result = runPatternScan({
      targetPath: subDir,
      extensions: new Set([".ts"]),
      patterns: BUSY_LOOP_PATTERN,
      toolName: "test",
      heading: "Test",
      passMsg: "clean",
      failNoun: "issue(s)",
      astRefine,
    });
    const findings = result.json?.findings || [];
    assert.equal(findings.length, 0, "comment match should be removed by AST");
  });
});

// ═══ 3. Fail-open: null astRefine ═══════════════════════════════════════

describe("hybrid: fail-open", () => {
  it("works without astRefine (null)", () => {
    const subDir = join(tmpDir, "no-ast-test");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "loop.ts"), `
while (true) {
  if (done()) break;
}
`, "utf8");
    const result = runPatternScan({
      targetPath: subDir,
      extensions: new Set([".ts"]),
      patterns: BUSY_LOOP_PATTERN,
      toolName: "test",
      heading: "Test",
      passMsg: "clean",
      failNoun: "issue(s)",
      astRefine: null,
    });
    // Without AST, regex finding should remain
    const findings = result.json?.findings || [];
    assert.equal(findings.length, 1, "without AST, regex finding should remain");
  });
});

// ═══ 4. scan-ignore still works alongside AST ═══════════════════════════

describe("hybrid: scan-ignore + AST coexistence", () => {
  it("scan-ignore removes line before AST runs", () => {
    const subDir = join(tmpDir, "ignore-test");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "ignored.ts"),
      '{ re: /while\\s*\\(\\s*true\\s*\\)/m, label: "busy-loop" }, // scan-ignore\n', "utf8");
    const astRefine = createAstRefineCallback(subDir);
    const result = runPatternScan({
      targetPath: subDir,
      extensions: new Set([".ts"]),
      patterns: BUSY_LOOP_PATTERN,
      toolName: "test",
      heading: "Test",
      passMsg: "clean",
      failNoun: "issue(s)",
      astRefine,
    });
    const findings = result.json?.findings || [];
    assert.equal(findings.length, 0, "scan-ignore should suppress before AST");
  });
});
