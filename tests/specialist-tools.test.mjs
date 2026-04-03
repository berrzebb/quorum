#!/usr/bin/env node
/**
 * Specialist Domain Tool Tests — verifies all 8 specialist MCP tools.
 *
 * Run: node --test tests/specialist-tools.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const { getTool } = await import("../platform/core/tools/registry.mjs");
const toolPerfScan = getTool("perf_scan").execute;
const toolCompatCheck = getTool("compat_check").execute;
const toolA11yScan = getTool("a11y_scan").execute;
const toolLicenseScan = getTool("license_scan").execute;
const toolI18nValidate = getTool("i18n_validate").execute;
const toolInfraScan = getTool("infra_scan").execute;
const toolObservabilityCheck = getTool("observability_check").execute;
const toolDocCoverage = getTool("doc_coverage").execute;
const toolAiGuide = getTool("ai_guide").execute;

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "specialist-tools-"));
});
after(() => {
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { console.warn("specialist-tools cleanup failed:", err?.message ?? err); }
});

// ═══ 1. perf_scan ══════════════════════════════════════════════════════

describe("perf_scan", () => {
  it("detects nested forEach", () => {
    const dir = join(tmpDir, "perf-nested");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.ts"), "items.forEach(i => { sub.forEach(s => console.log(s)); });\n");
    const result = toolPerfScan({ path: dir });
    assert.ok(result.text.includes("nested-loop") || result.text.includes("O(n²)"));
  });

  it("detects sync I/O", () => {
    const dir = join(tmpDir, "perf-sync");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sync.ts"), "const data = readFileSync('file.txt');\n");
    const result = toolPerfScan({ path: dir });
    assert.ok(result.text.includes("sync-io") || result.text.includes("Synchronous"));
  });

  it("detects unbounded query", () => {
    const dir = join(tmpDir, "perf-query");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "query.ts"), "const all = await db.findAll();\n");
    const result = toolPerfScan({ path: dir });
    assert.ok(result.text.includes("unbounded") || result.text.includes("findAll"));
  });

  it("returns error for nonexistent path", () => {
    const result = toolPerfScan({ path: "/nonexistent/path/xxx" });
    assert.ok(result.error);
  });
});

// ═══ 2. compat_check ═══════════════════════════════════════════════════

describe("compat_check", () => {
  it("detects @deprecated", () => {
    const dir = join(tmpDir, "compat-deprecated");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old.ts"), "/** @deprecated Use newFn instead */\nexport function oldFn() {}\n");
    const result = toolCompatCheck({ path: dir });
    assert.ok(result.text.includes("deprecated"));
  });

  it("detects CJS require in ESM", () => {
    const dir = join(tmpDir, "compat-cjs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mixed.ts"), "const fs = require('node:fs');\n");
    const result = toolCompatCheck({ path: dir });
    assert.ok(result.text.includes("cjs-require") || result.text.includes("CommonJS"));
  });

});

// ═══ 3. a11y_scan ══════════════════════════════════════════════════════

describe("a11y_scan", () => {
  it("detects img without alt", () => {
    const dir = join(tmpDir, "a11y-noalt");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Comp.tsx"), '<img src="photo.jpg" />\n');
    const result = toolA11yScan({ path: dir });
    assert.ok(result.text.includes("img-no-alt") || result.text.includes("missing alt"));
  });

  it("detects div with onClick", () => {
    const dir = join(tmpDir, "a11y-div-click");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Btn.tsx"), '<div onClick={handleClick}>Click</div>\n');
    const result = toolA11yScan({ path: dir });
    assert.ok(result.text.includes("div-click") || result.text.includes("button"));
  });

});

// ═══ 4. license_scan ═══════════════════════════════════════════════════

describe("license_scan", () => {
  it("detects hardcoded secret pattern", () => {
    const dir = join(tmpDir, "license-secret");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.ts"), 'const password = "s3cret123";\n');
    const result = toolLicenseScan({ path: dir });
    assert.ok(result.text.includes("hardcoded-secret") || result.text.includes("secret"));
  });
});

// ═══ 5. i18n_validate ══════════════════════════════════════════════════

describe("i18n_validate", () => {
  it("detects parity gap between locales", () => {
    const dir = join(tmpDir, "i18n-gap");
    const localeDir = join(dir, "locales");
    mkdirSync(localeDir, { recursive: true });
    writeFileSync(join(localeDir, "en.json"), JSON.stringify({ greeting: "Hello", farewell: "Bye" }));
    writeFileSync(join(localeDir, "ko.json"), JSON.stringify({ greeting: "안녕" }));
    const result = toolI18nValidate({ path: dir });
    assert.ok(result.text.includes("i18n-parity") || result.text.includes("Missing key"));
    assert.ok(result.text.includes("farewell"));
  });

  it("handles nested locale keys", () => {
    const dir = join(tmpDir, "i18n-nested");
    const localeDir = join(dir, "locales");
    mkdirSync(localeDir, { recursive: true });
    writeFileSync(join(localeDir, "en.json"), JSON.stringify({ nav: { home: "Home", about: "About" } }));
    writeFileSync(join(localeDir, "ko.json"), JSON.stringify({ nav: { home: "홈" } }));
    const result = toolI18nValidate({ path: dir });
    assert.ok(result.text.includes("nav.about"));
  });
});

// ═══ 6. infra_scan ═════════════════════════════════════════════════════

describe("infra_scan", () => {
  it("detects FROM :latest", () => {
    const dir = join(tmpDir, "infra-latest");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Dockerfile"), "FROM node:latest\nRUN npm install\n");
    const result = toolInfraScan({ path: dir });
    assert.ok(result.text.includes("latest-tag") || result.text.includes(":latest"));
  });

  it("detects privileged container", () => {
    const dir = join(tmpDir, "infra-priv");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "docker-compose.yml"), "services:\n  app:\n    privileged: true\n");
    const result = toolInfraScan({ path: dir });
    assert.ok(result.text.toLowerCase().includes("privileged"));
  });

});

// ═══ 7. observability_check ════════════════════════════════════════════

describe("observability_check", () => {
  it("detects empty catch block", () => {
    const dir = join(tmpDir, "obs-empty-catch");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.ts"), "try { doThing(); } catch(e) {}\n");
    const result = toolObservabilityCheck({ path: dir });
    assert.ok(result.text.includes("empty-catch") || result.text.includes("silently swallowed"));
  });

  it("detects console.log", () => {
    const dir = join(tmpDir, "obs-console");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "debug.ts"), 'console.log("debug value");\n');
    const result = toolObservabilityCheck({ path: dir });
    assert.ok(result.text.includes("console-log") || result.text.includes("console.log"));
  });

  it("detects empty Error()", () => {
    const dir = join(tmpDir, "obs-empty-error");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "err.ts"), "throw new Error();\n");
    const result = toolObservabilityCheck({ path: dir });
    assert.ok(result.text.includes("empty-error") || result.text.includes("no message"));
  });
});

// ═══ 8. doc_coverage ═══════════════════════════════════════════════════

describe("doc_coverage", () => {
  it("detects undocumented exports", () => {
    const dir = join(tmpDir, "doc-missing");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lib.ts"), "export function undocumented() {}\n");
    const result = toolDocCoverage({ path: dir });
    assert.ok(result.text.includes("0%") || result.text.includes("undocumented"));
  });

  it("handles mixed documented/undocumented", () => {
    const dir = join(tmpDir, "doc-mixed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mix.ts"), [
      "/** Documented fn. */",
      "export function documented() {}",
      "",
      "export function notDoc() {}",
    ].join("\n"));
    const result = toolDocCoverage({ path: dir });
    assert.ok(result.json);
    assert.equal(result.json.totalExports, 2);
    assert.equal(result.json.documentedExports, 1);
    assert.equal(result.json.coverage, 50);
  });

});

// ═══ 10. ai_guide ═══════════════════════════════════════════════════════

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __test_dirname = dirname(fileURLToPath(import.meta.url));

describe("ai_guide", () => {
  it("generates guide for a directory", () => {
    const result = toolAiGuide({ target: resolve(__test_dirname, "..") });
    assert.ok(result.text.includes("# AI-GUIDE"));
    assert.ok(result.text.includes("## Architecture Overview"));
    assert.ok(result.text.includes("## Key Modules"));
    assert.ok(result.summary);
  });

  it("includes entry points", () => {
    const result = toolAiGuide({ target: resolve(__test_dirname, "..") });
    assert.ok(result.text.includes("## Entry Points"));
  });

  it("handles non-existent directory gracefully", () => {
    const result = toolAiGuide({ target: "/nonexistent/path" });
    assert.ok(result.text.includes("AI-GUIDE"));
    assert.ok(result.summary);
  });

  it("includes documentation gaps section", () => {
    const result = toolAiGuide({ target: resolve(__test_dirname, "..") });
    assert.ok(result.text.includes("## Documentation Gaps"));
  });

  it("includes quick commands section", () => {
    const result = toolAiGuide({ target: resolve(__test_dirname, "..") });
    assert.ok(result.text.includes("## Quick Commands"));
  });

  it("returns json with projectName", () => {
    const result = toolAiGuide({ target: resolve(__test_dirname, "..") });
    assert.ok(result.json);
    assert.ok(result.json.projectName);
  });

  it("works on a minimal temp directory", () => {
    const dir = join(tmpDir, "ai-guide-minimal");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), "export function main() {}\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-proj", scripts: { build: "tsc" } }));
    const result = toolAiGuide({ target: dir });
    assert.ok(result.text.includes("# AI-GUIDE: test-proj"));
    assert.ok(result.text.includes("npm run"));
    assert.ok(!result.error);
  });
});
