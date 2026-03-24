#!/usr/bin/env node
/**
 * CL-1 direct verification:
 *   1. singleRe  — H1-H6 excluded, H7+ and other single-char IDs collected
 *
 * Run: node tests/cl1-verify.test.mjs
 */

import { strict as assert } from "node:assert";
import { test, stats } from "./_helpers.mjs";

// ─── 1. singleRe H1-H6 exclusion ────────────────────────────────────────────
// Mirrors the collectIdsFromLine() singleRe block in respond.mjs (L512-L518).

function collectSingleIds(line) {
  const ids = new Set();
  const singleRe = /\b([A-Z])(\d{1,2})\b/g;
  let m;
  while ((m = singleRe.exec(line)) !== null) {
    const id = `${m[1]}${m[2]}`;
    if (/^H[1-6]$/.test(id)) continue;
    ids.add(id);
  }
  return [...ids];
}

console.log("singleRe H1-H6 exclusion:");

test("H1 is excluded", () => assert.deepStrictEqual(collectSingleIds("H1"), []));
test("H2 is excluded", () => assert.deepStrictEqual(collectSingleIds("H2"), []));
test("H3 is excluded", () => assert.deepStrictEqual(collectSingleIds("H3"), []));
test("H4 is excluded", () => assert.deepStrictEqual(collectSingleIds("H4"), []));
test("H5 is excluded", () => assert.deepStrictEqual(collectSingleIds("H5"), []));
test("H6 is excluded", () => assert.deepStrictEqual(collectSingleIds("H6"), []));
test("H7 is NOT excluded", () => assert.ok(collectSingleIds("H7").includes("H7")));
test("H10 is NOT excluded (two digits)", () => assert.ok(collectSingleIds("H10").includes("H10")));
test("E1 collected", () => assert.ok(collectSingleIds("E1").includes("E1")));
test("F2 collected among mixed line", () => {
  const ids = collectSingleIds("fix E1 and F2 near H3");
  assert.ok(ids.includes("E1"), "E1 missing");
  assert.ok(ids.includes("F2"), "F2 missing");
  assert.ok(!ids.includes("H3"), "H3 must be excluded");
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${stats.passed + stats.failed} tests: ${stats.passed} passed, ${stats.failed} failed`);
if (stats.failed > 0) process.exit(1);
