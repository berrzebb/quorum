#!/usr/bin/env node
/**
 * AST Analyzer — Program Mode Tests.
 *
 * Tests cross-file analysis:
 *   1. initProgram — loads tsconfig
 *   2. detectUnusedExports — finds exports not imported elsewhere
 *   3. detectImportCycles — finds circular imports
 *   4. analyzeProgram — combined analysis
 *
 * Run: node --test tests/ast-program.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const { ASTAnalyzer } = await import("../dist/platform/providers/ast-analyzer.js");

// ── Test fixture: a mini TypeScript project ─────────

const FIXTURE_DIR = resolve("tests/.fixtures/ast-program-test");

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    outDir: "dist",
    rootDir: ".",
  },
  include: ["**/*.ts"],
};

const FILE_A = `
export function usedFn() { return 1; }
export function unusedFn() { return 2; }
export const USED_CONST = "hello";
export const UNUSED_CONST = "world";
export interface UsedInterface { x: number; }
export interface UnusedInterface { y: string; }
`;

const FILE_B = `
import { usedFn, USED_CONST } from "./a.js";
import type { UsedInterface } from "./a.js";

export function doStuff(): UsedInterface {
  return { x: usedFn() + USED_CONST.length };
}
`;

const FILE_C = `
import { doStuff } from "./b.js";
export const result = doStuff();
`;

// Cycle: d → e → f → d
const FILE_D = `
import { fromF } from "./f.js";
export function fromD() { return fromF(); }
`;

const FILE_E = `
import { fromD } from "./d.js";
export function fromE() { return fromD(); }
`;

const FILE_F = `
import { fromE } from "./e.js";
export function fromF() { return fromE(); }
`;

before(() => {
  // Create fixture directory and files
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(join(FIXTURE_DIR, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
  writeFileSync(join(FIXTURE_DIR, "a.ts"), FILE_A);
  writeFileSync(join(FIXTURE_DIR, "b.ts"), FILE_B);
  writeFileSync(join(FIXTURE_DIR, "c.ts"), FILE_C);
  writeFileSync(join(FIXTURE_DIR, "d.ts"), FILE_D);
  writeFileSync(join(FIXTURE_DIR, "e.ts"), FILE_E);
  writeFileSync(join(FIXTURE_DIR, "f.ts"), FILE_F);
});

after(() => {
  // Clean up fixture directory
  try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

// ═══ 1. initProgram ═══════════════════════════════════

describe("ast-program: initProgram", () => {
  it("loads tsconfig successfully", () => {
    const analyzer = new ASTAnalyzer({ mode: "program" });
    const ok = analyzer.initProgram(join(FIXTURE_DIR, "tsconfig.json"));
    assert.ok(ok, "Should initialize program from tsconfig");
  });

  it("returns false for missing tsconfig", () => {
    const analyzer = new ASTAnalyzer({ mode: "program" });
    const ok = analyzer.initProgram(join(FIXTURE_DIR, "nonexistent.json"));
    assert.equal(ok, false);
  });

  it("returns false when no path given and no config path", () => {
    const analyzer = new ASTAnalyzer({ mode: "program" });
    const ok = analyzer.initProgram();
    assert.equal(ok, false);
  });
});

// ═══ 2. detectUnusedExports ═══════════════════════════

describe("ast-program: detectUnusedExports", () => {
  let analyzer;

  before(() => {
    analyzer = new ASTAnalyzer({ mode: "program" });
    analyzer.initProgram(join(FIXTURE_DIR, "tsconfig.json"));
  });

  it("finds unused exports", () => {
    const unused = analyzer.detectUnusedExports();
    const unusedNames = unused.map(u => u.name);

    // unusedFn and UNUSED_CONST in a.ts should be unused
    assert.ok(unusedNames.includes("unusedFn"), `Should find unusedFn, got: ${unusedNames}`);
    assert.ok(unusedNames.includes("UNUSED_CONST"), `Should find UNUSED_CONST, got: ${unusedNames}`);
    assert.ok(unusedNames.includes("UnusedInterface"), `Should find UnusedInterface, got: ${unusedNames}`);
  });

  it("does not flag used exports", () => {
    const unused = analyzer.detectUnusedExports();
    const unusedNames = unused.map(u => u.name);

    assert.ok(!unusedNames.includes("usedFn"), "usedFn is imported by b.ts");
    assert.ok(!unusedNames.includes("USED_CONST"), "USED_CONST is imported by b.ts");
    assert.ok(!unusedNames.includes("UsedInterface"), "UsedInterface is imported by b.ts");
    assert.ok(!unusedNames.includes("doStuff"), "doStuff is imported by c.ts");
  });

  it("reports correct file and kind", () => {
    const unused = analyzer.detectUnusedExports();
    const unusedFn = unused.find(u => u.name === "unusedFn");
    assert.ok(unusedFn);
    assert.ok(unusedFn.file.includes("a.ts"), `Expected a.ts, got ${unusedFn.file}`);
    assert.equal(unusedFn.kind, "function");

    const unusedConst = unused.find(u => u.name === "UNUSED_CONST");
    assert.ok(unusedConst);
    assert.equal(unusedConst.kind, "variable");

    const unusedIface = unused.find(u => u.name === "UnusedInterface");
    assert.ok(unusedIface);
    assert.equal(unusedIface.kind, "interface");
  });

  it("returns empty when program not initialized", () => {
    const fresh = new ASTAnalyzer({ mode: "program" });
    const unused = fresh.detectUnusedExports();
    assert.equal(unused.length, 0);
  });
});

// ═══ 3. detectImportCycles ════════════════════════════

describe("ast-program: detectImportCycles", () => {
  let analyzer;

  before(() => {
    analyzer = new ASTAnalyzer({ mode: "program" });
    analyzer.initProgram(join(FIXTURE_DIR, "tsconfig.json"));
  });

  it("detects the d → e → f → d cycle", () => {
    const cycles = analyzer.detectImportCycles();
    assert.ok(cycles.length > 0, "Should find at least one cycle");

    // Find the cycle involving d, e, f
    const hasCycle = cycles.some(c => {
      const files = c.files.map(f => f.replace(/\\/g, "/"));
      return files.some(f => f.includes("d.ts")) &&
             files.some(f => f.includes("e.ts")) &&
             files.some(f => f.includes("f.ts"));
    });
    assert.ok(hasCycle, `Should find d→e→f cycle, found: ${JSON.stringify(cycles.map(c => c.files.map(f => f.split("/").pop())))}`);
  });

  it("does not report non-cyclic imports as cycles", () => {
    const cycles = analyzer.detectImportCycles();
    // a → b → c is not a cycle
    const hasABCCycle = cycles.some(c => {
      const files = c.files.map(f => f.replace(/\\/g, "/"));
      return files.some(f => f.includes("a.ts")) &&
             files.some(f => f.includes("b.ts")) &&
             files.some(f => f.includes("c.ts")) &&
             !files.some(f => f.includes("d.ts"));
    });
    assert.ok(!hasABCCycle, "a→b→c is NOT a cycle");
  });

  it("returns empty when program not initialized", () => {
    const fresh = new ASTAnalyzer({ mode: "program" });
    const cycles = fresh.detectImportCycles();
    assert.equal(cycles.length, 0);
  });
});

// ═══ 4. analyzeProgram (combined) ═════════════════════

describe("ast-program: analyzeProgram", () => {
  it("returns combined results", () => {
    const analyzer = new ASTAnalyzer({ mode: "program" });
    const result = analyzer.analyzeProgram(join(FIXTURE_DIR, "tsconfig.json"));

    assert.ok(result.fileCount > 0, "Should have files");
    assert.ok(result.duration >= 0, "Should have duration");
    assert.ok(result.unusedExports.length > 0, "Should find unused exports");
    assert.ok(result.importCycles.length > 0, "Should find import cycles");
  });

  it("returns empty for invalid tsconfig", () => {
    const analyzer = new ASTAnalyzer({ mode: "program" });
    const result = analyzer.analyzeProgram(join(FIXTURE_DIR, "nonexistent.json"));
    assert.equal(result.fileCount, 0);
    assert.equal(result.unusedExports.length, 0);
    assert.equal(result.importCycles.length, 0);
  });
});
