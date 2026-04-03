#!/usr/bin/env node
/**
 * AST Analyzer Tests — TypeScript Compiler API wrapper validation.
 *
 * Tests 5 analysis capabilities:
 *   1. `as any` / `as unknown` detection
 *   2. while(true) control flow (safe vs unsafe)
 *   3. Context-aware filtering (string/comment exclusion)
 *   4. Cyclomatic complexity calculation
 *   5. Type assertion counting + export counting
 *
 * Run: node --test tests/ast-analyzer.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { ASTAnalyzer } = await import("../dist/platform/providers/ast-analyzer.js");

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ast-test-"));
});

after(() => {
  try {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  } catch (err) { console.warn("ast-analyzer cleanup failed:", err?.message ?? err); }
});

/** Write a temp .ts file and return its path. */
function writeTempTS(name, content) {
  const p = join(tmpDir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

// ═══ 1. as any / as unknown detection ════════════════════════════════════

describe("as-any detection", () => {
  it("flags `as any` with high severity", () => {
    const file = writeTempTS("as-any.ts", `
const x = getSomething() as any;
const y = getOther() as string;
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    const asAnyFindings = result.findings.filter(f => f.category === "unnecessary-assertion");
    assert.equal(asAnyFindings.length, 1);
    assert.equal(asAnyFindings[0].severity, "high");
    assert.ok(asAnyFindings[0].message.includes("as any"));
  });

  it("flags `as unknown` with medium severity", () => {
    const file = writeTempTS("as-unknown.ts", `
const x = getVal() as unknown;
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    const findings = result.findings.filter(f => f.category === "unnecessary-assertion");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "medium");
    assert.ok(findings[0].message.includes("as unknown"));
  });

  it("does not flag `as string` or `as number`", () => {
    const file = writeTempTS("as-specific.ts", `
const x = getVal() as string;
const y = getNum() as number;
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    const findings = result.findings.filter(f => f.category === "unnecessary-assertion");
    assert.equal(findings.length, 0);
  });

  it("counts total type assertions in metrics", () => {
    const file = writeTempTS("assertion-count.ts", `
const a = x as any;
const b = y as string;
const c = z as number;
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    assert.equal(result.metrics.typeAssertionCount, 3);
  });
});

// ═══ 2. while(true) control flow ═════════════════════════════════════════

describe("while(true) control flow", () => {
  it("marks while(true) with break as safe-loop", () => {
    const file = writeTempTS("safe-loop.ts", `
function poll() {
  while (true) {
    const msg = receive();
    if (msg === "done") break;
    process(msg);
  }
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    const safe = result.findings.filter(f => f.category === "safe-loop");
    assert.equal(safe.length, 1);
    assert.equal(safe[0].overridesRegex, true);
    assert.equal(safe[0].regexLabel, "busy-loop");
  });

  it("marks while(true) with return as safe-loop", () => {
    const file = writeTempTS("safe-return.ts", `
function tryGet() {
  while (true) {
    const val = attempt();
    if (val) return val;
  }
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    const safe = result.findings.filter(f => f.category === "safe-loop");
    assert.equal(safe.length, 1);
  });

  it("marks while(true) without exit as unsafe-loop", () => {
    const file = writeTempTS("unsafe-loop.ts", `
function spin() {
  while (true) {
    doWork();
  }
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    const unsafe = result.findings.filter(f => f.category === "unsafe-loop");
    assert.equal(unsafe.length, 1);
    assert.equal(unsafe[0].severity, "high");
  });

  it("does not flag while(condition)", () => {
    const file = writeTempTS("while-cond.ts", `
function loop() {
  let i = 0;
  while (i < 10) { i++; }
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    const loops = result.findings.filter(
      f => f.category === "safe-loop" || f.category === "unsafe-loop"
    );
    assert.equal(loops.length, 0);
  });

  it("does not count nested function break as outer while exit", () => {
    const file = writeTempTS("nested-fn.ts", `
function outer() {
  while (true) {
    const inner = () => { return 1; };
    doWork();
  }
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    // The arrow function's return doesn't exit the while, so it's unsafe
    const unsafe = result.findings.filter(f => f.category === "unsafe-loop");
    assert.equal(unsafe.length, 1);
  });
});

// ═══ 3. Cyclomatic complexity ════════════════════════════════════════════

describe("cyclomatic complexity", () => {
  it("computes complexity 1 for a trivial function", () => {
    const file = writeTempTS("trivial.ts", `
function add(a: number, b: number): number {
  return a + b;
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    assert.equal(result.metrics.maxCyclomaticComplexity, 1);
  });

  it("counts if/else/for/while branches", () => {
    const file = writeTempTS("branches.ts", `
function complex(items: number[]) {
  if (items.length === 0) return [];
  const result: number[] = [];
  for (const item of items) {
    if (item > 0) {
      result.push(item);
    } else if (item === 0) {
      continue;
    }
  }
  while (result.length < 10) {
    result.push(0);
  }
  return result;
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    // base(1) + if(1) + for(1) + if(1) + else-if(1) + while(1) = 6
    assert.ok(result.metrics.maxCyclomaticComplexity >= 5,
      `Expected >= 5, got ${result.metrics.maxCyclomaticComplexity}`);
  });

  it("counts logical operators (&&, ||, ??)", () => {
    const file = writeTempTS("logical.ts", `
function check(a: boolean, b: boolean, c?: string) {
  if (a && b) return true;
  return c ?? "default";
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    // base(1) + if(1) + &&(1) + ??(1) = 4
    assert.ok(result.metrics.maxCyclomaticComplexity >= 3,
      `Expected >= 3, got ${result.metrics.maxCyclomaticComplexity}`);
  });

  it("computes average across multiple functions", () => {
    const file = writeTempTS("multi-fn.ts", `
function simple() { return 1; }
function medium(x: boolean) { if (x) return 2; return 3; }
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    // simple: 1, medium: 2 → avg: 1.5
    assert.ok(result.metrics.avgCyclomaticComplexity > 1);
    assert.ok(result.metrics.avgCyclomaticComplexity <= 2);
  });
});

// ═══ 5. refineCandidates — regex→AST refinement ═════════════════════════

describe("refineCandidates", () => {
  it("marks regex match inside a comment as false positive", () => {
    // No leading newline — comment is on line 1
    const file = writeTempTS("comment-fp.ts",
      "// while(true) — this is just a comment, not real code\nconst x = 1;\n");
    const analyzer = new ASTAnalyzer();
    const findings = analyzer.refineCandidates([
      { file, line: 1, regexLabel: "busy-loop", regexSeverity: "high" },
    ]);
    const fps = findings.filter(f => f.category === "context-false-positive");
    assert.equal(fps.length, 1);
    assert.equal(fps[0].overridesRegex, true);
  });

  it("marks regex match inside a string literal as false positive (with column)", () => {
    // 'const msg = "while(true) is dangerous";'
    //               ^ column 14 (1-indexed) — inside the string
    const file = writeTempTS("string-fp.ts",
      'const msg = "while(true) is dangerous";\n');
    const analyzer = new ASTAnalyzer();
    const findings = analyzer.refineCandidates([
      { file, line: 1, column: 14, regexLabel: "busy-loop", regexSeverity: "high" },
    ]);
    const fps = findings.filter(f => f.category === "context-false-positive");
    assert.equal(fps.length, 1);
  });

  it("confirms while(true) with break is safe via refinement", () => {
    const file = writeTempTS("refine-safe.ts",
      "while (true) {\n  if (done()) break;\n}\n");
    const analyzer = new ASTAnalyzer();
    const findings = analyzer.refineCandidates([
      { file, line: 1, regexLabel: "busy-loop", regexSeverity: "high" },
    ]);
    const safe = findings.filter(f => f.category === "safe-loop");
    assert.equal(safe.length, 1);
    assert.equal(safe[0].overridesRegex, true);
  });
});

// ═══ 6. Aggregate metrics ════════════════════════════════════════════════

describe("getAggregateMetrics", () => {
  it("aggregates across multiple files", () => {
    const f1 = writeTempTS("agg1.ts", `
export function a() { return 1; }
const x = y as any;
`);
    const f2 = writeTempTS("agg2.ts", `
export function b(flag: boolean) {
  if (flag) return 1;
  return 2;
}
`);
    const analyzer = new ASTAnalyzer();
    const results = analyzer.analyzeFiles([f1, f2]);
    const agg = analyzer.getAggregateMetrics(results);

    assert.equal(agg.totalFiles, 2);
    assert.equal(agg.totalAssertions, 1);
    assert.ok(agg.avgComplexity > 0);
    assert.ok(agg.totalEffectiveLines > 0);
  });

  it("returns zeroes for empty input", () => {
    const analyzer = new ASTAnalyzer();
    const agg = analyzer.getAggregateMetrics([]);
    assert.equal(agg.totalFiles, 0);
    assert.equal(agg.avgComplexity, 0);
    assert.equal(agg.maxComplexity, 0);
  });
});

// ═══ 7. Edge cases ══════════════════════════════════════════════════════

describe("edge cases", () => {
  it("handles TSX files", () => {
    const file = writeTempTS("component.tsx", `
export function App() {
  const x = props as any;
  return <div>{x}</div>;
}
`);
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].category, "unnecessary-assertion");
  });

  it("handles empty files gracefully", () => {
    const file = writeTempTS("empty.ts", "");
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    assert.equal(result.findings.length, 0);
    assert.equal(result.metrics.effectiveLines, 0);
  });

  it("respects maxFiles config", () => {
    const files = Array.from({ length: 5 }, (_, i) =>
      writeTempTS(`max-${i}.ts`, `const x${i} = 1;`)
    );
    const analyzer = new ASTAnalyzer({ maxFiles: 2 });
    const results = analyzer.analyzeFiles(files);
    assert.equal(results.length, 2);
  });

  it("fail-open on unparseable file", () => {
    const file = writeTempTS("bad.ts", "");
    // Overwrite with binary garbage
    writeFileSync(file, Buffer.from([0xFF, 0xFE, 0x00]));
    const analyzer = new ASTAnalyzer();
    const [result] = analyzer.analyzeFiles([file]);
    // Should not throw, should return empty findings
    assert.equal(result.findings.length, 0);
  });
});
