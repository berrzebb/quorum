#!/usr/bin/env node
/**
 * Wave Gate Tests — mechanical enforcement gates in orchestrate runner.
 *
 * Tests:
 *   1. updateRTM — RTM status column replacement (implemented/passed/failed)
 *   2. buildDepContextFromManifests — MessageBus manifest → prompt context
 *   3. waveCommit — git add + WIP commit in temp repo
 *   4. verifyPhaseCompletion — phase gate: incomplete items, verify failures
 *   5. detectRegressions — overwrite detection via git numstat
 *
 * Run: node --test tests/wave-gates.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

const {
  updateRTM,
  buildDepContextFromManifests,
  waveCommit,
  verifyPhaseCompletion,
  detectRegressions,
  runProjectTests,
  scanForStubs,
  scanLines,
  getChangedFiles,
  detectFileScopeViolations,
  scanBlueprintViolations,
  detectOrphanFiles,
  scanForPerfAntiPatterns,
  auditNewDependencies,
  checkTestFileCreation,
  checkWBConstraints,
  detectFixLoopStagnation,
} = await import("../dist/platform/cli/commands/orchestrate/runner.js");

// ── Helpers ──────────────────────────────────

function createTmpGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "wave-gate-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name test", { cwd: dir, stdio: "pipe" });
  // Initial commit
  writeFileSync(join(dir, ".gitkeep"), "");
  execSync("git add .gitkeep && git commit -m init", { cwd: dir, stdio: "pipe" });
  return dir;
}

// ═══ 1. updateRTM — status column replacement ══════════════════════════

describe("updateRTM", () => {
  let tmpDir;
  let rtmPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rtm-test-"));
    rtmPath = join(tmpDir, "rtm.md");
  });

  it("replaces pending → implemented for matching item ID", () => {
    const rtm = [
      "| Req ID | Description | Files | Verify | Done | Status |",
      "|--------|-------------|-------|--------|------|--------|",
      "| WB-01 | Setup audio | src/audio.ts | npm test | works | pending |",
      "| WB-02 | Add UI | src/ui.ts | npm test | works | pending |",
    ].join("\n");
    writeFileSync(rtmPath, rtm);

    updateRTM(rtmPath, [{ id: "WB-01", targetFiles: ["src/audio.ts"] }], "implemented");

    const result = readFileSync(rtmPath, "utf8");
    assert.ok(result.includes("| WB-01 |") && result.includes("implemented |"),
      "WB-01 should be implemented");
    assert.ok(result.includes("| WB-02 |") && result.includes("pending |"),
      "WB-02 should remain pending");
  });

  it("replaces implemented → passed after audit", () => {
    const rtm = "| WB-03 | Test | f.ts | cmd | ok | implemented |";
    writeFileSync(rtmPath, rtm);

    updateRTM(rtmPath, [{ id: "WB-03", targetFiles: [] }], "passed");

    const result = readFileSync(rtmPath, "utf8");
    assert.ok(result.includes("passed |"), "WB-03 should be passed");
    assert.ok(!result.includes("implemented |"), "implemented should be gone");
  });

  it("replaces implemented → failed on audit failure", () => {
    const rtm = "| WB-04 | Test | f.ts | cmd | ok | implemented |";
    writeFileSync(rtmPath, rtm);

    updateRTM(rtmPath, [{ id: "WB-04", targetFiles: [] }], "failed");

    const result = readFileSync(rtmPath, "utf8");
    assert.ok(result.includes("failed |"));
  });

  it("handles multi-segment IDs like DAW-P2-01", () => {
    const rtm = "| DAW-P2-01 | Audio engine | src/engine.ts | npm test | ok | pending |";
    writeFileSync(rtmPath, rtm);

    updateRTM(rtmPath, [{ id: "DAW-P2-01", targetFiles: [] }], "implemented");

    const result = readFileSync(rtmPath, "utf8");
    assert.ok(result.includes("implemented |"), "Multi-segment ID should match");
  });

  it("handles multiple items in one call", () => {
    const rtm = [
      "| WB-01 | A | a.ts | t | ok | pending |",
      "| WB-02 | B | b.ts | t | ok | pending |",
      "| WB-03 | C | c.ts | t | ok | pending |",
    ].join("\n");
    writeFileSync(rtmPath, rtm);

    updateRTM(rtmPath, [
      { id: "WB-01", targetFiles: [] },
      { id: "WB-03", targetFiles: [] },
    ], "passed");

    const result = readFileSync(rtmPath, "utf8");
    const lines = result.split("\n");
    assert.ok(lines[0].includes("passed |"), "WB-01 passed");
    assert.ok(lines[1].includes("pending |"), "WB-02 still pending");
    assert.ok(lines[2].includes("passed |"), "WB-03 passed");
  });

  it("no-ops on missing file", () => {
    // Should not throw
    updateRTM(join(tmpDir, "nonexistent.md"), [{ id: "X", targetFiles: [] }], "passed");
  });
});

// ═══ 2. buildDepContextFromManifests — pure function ════════════════════

describe("buildDepContextFromManifests", () => {
  it("returns empty for items without dependencies", () => {
    const result = buildDepContextFromManifests(
      { id: "WB-01", targetFiles: ["a.ts"] },
      [{ waveIndex: 0, completedItems: ["WB-00"], changedFiles: ["b.ts"], fileExports: {} }],
    );
    assert.strictEqual(result, "");
  });

  it("returns empty when no manifests match dependencies", () => {
    const result = buildDepContextFromManifests(
      { id: "WB-02", targetFiles: ["a.ts"], dependsOn: ["WB-01"] },
      [{ waveIndex: 0, completedItems: ["WB-99"], changedFiles: ["b.ts"], fileExports: {} }],
    );
    assert.strictEqual(result, "");
  });

  it("injects context when manifest matches dependency", () => {
    const result = buildDepContextFromManifests(
      { id: "WB-02", targetFiles: ["a.ts"], dependsOn: ["WB-01"] },
      [{
        waveIndex: 0,
        completedItems: ["WB-01"],
        changedFiles: ["src/audio.ts", "src/types.ts"],
        fileExports: {
          "src/audio.ts": ["export class AudioProcessor {", "export function createBuffer() {"],
          "src/types.ts": ["export interface AudioConfig {"],
        },
        recordedAt: Date.now(),
      }],
    );
    assert.ok(result.includes("Dependency Output"), "Should have header");
    assert.ok(result.includes("Wave 1"), "Should reference wave 1");
    assert.ok(result.includes("WB-01"), "Should reference dep ID");
    assert.ok(result.includes("AudioProcessor"), "Should include exports");
    assert.ok(result.includes("AudioConfig"), "Should include type exports");
  });

  it("handles multiple dependencies across waves", () => {
    const result = buildDepContextFromManifests(
      { id: "WB-05", targetFiles: [], dependsOn: ["WB-01", "WB-03"] },
      [
        { waveIndex: 0, completedItems: ["WB-01"], changedFiles: ["a.ts"], fileExports: { "a.ts": ["export const A = 1;"] }, recordedAt: 0 },
        { waveIndex: 1, completedItems: ["WB-02"], changedFiles: ["b.ts"], fileExports: {}, recordedAt: 0 },
        { waveIndex: 2, completedItems: ["WB-03", "WB-04"], changedFiles: ["c.ts"], fileExports: { "c.ts": ["export const C = 3;"] }, recordedAt: 0 },
      ],
    );
    assert.ok(result.includes("Wave 1"), "Should include wave 1 (WB-01)");
    assert.ok(!result.includes("Wave 2"), "Should NOT include wave 2 (WB-02 not a dep)");
    assert.ok(result.includes("Wave 3"), "Should include wave 3 (WB-03)");
  });

  it("includes changed files even without exports", () => {
    const result = buildDepContextFromManifests(
      { id: "WB-02", targetFiles: [], dependsOn: ["WB-01"] },
      [{ waveIndex: 0, completedItems: ["WB-01"], changedFiles: ["a.ts", "b.ts"], fileExports: {}, recordedAt: 0 }],
    );
    assert.ok(result.includes("Changed: a.ts, b.ts"), "Should list changed files");
  });
});

// ═══ 3. waveCommit — git add + WIP commit ═══════════════════════════════

describe("waveCommit", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
  });

  it("commits changed files and returns true", () => {
    const file = "src/app.ts";
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, file), "export const x = 1;\n");

    const result = waveCommit(repo, [file], 1, "test-track");
    assert.strictEqual(result, true);

    const log = execSync("git log --oneline", { cwd: repo, encoding: "utf8" });
    assert.ok(log.includes("WIP(test-track/wave-1)"), "Commit message should match");
  });

  it("returns false when no files changed", () => {
    const result = waveCommit(repo, ["nonexistent.ts"], 1, "test");
    assert.strictEqual(result, false);
  });

  it("handles absolute paths (RTM path)", () => {
    const rtmPath = join(repo, "plans", "rtm.md");
    mkdirSync(join(repo, "plans"), { recursive: true });
    writeFileSync(rtmPath, "# RTM\n| WB-01 | test | pending |");

    const result = waveCommit(repo, [rtmPath], 1, "test");
    assert.strictEqual(result, true);

    const log = execSync("git log --oneline", { cwd: repo, encoding: "utf8" });
    assert.ok(log.includes("WIP(test/wave-1)"));
  });

  it("does not commit already-committed files", () => {
    writeFileSync(join(repo, "a.ts"), "const a = 1;");
    execSync("git add a.ts && git commit -m prev", { cwd: repo, stdio: "pipe" });

    // No new changes
    const result = waveCommit(repo, ["a.ts"], 2, "test");
    assert.strictEqual(result, false);
  });
});

// ═══ 4. verifyPhaseCompletion — phase gate ══════════════════════════════

describe("verifyPhaseCompletion", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
  });

  it("fails when items are incomplete", () => {
    const items = [
      { id: "WB-01", targetFiles: [] },
      { id: "WB-02", targetFiles: [] },
    ];
    const completedIds = new Set(["WB-01"]); // WB-02 missing

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.some(f => f.includes("WB-02")), "Should flag incomplete WB-02");
  });

  it("passes when all items completed and no verify commands", () => {
    const items = [
      { id: "WB-01", targetFiles: [] },
      { id: "WB-02", targetFiles: [] },
    ];
    const completedIds = new Set(["WB-01", "WB-02"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.failures.length, 0);
  });

  it("fails when verify command fails", () => {
    const items = [
      { id: "WB-01", targetFiles: [], verify: "node nonexistent-file-that-does-not-exist.js" },
    ];
    const completedIds = new Set(["WB-01"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.some(f => f.includes("verify")));
  });

  it("passes when verify command succeeds", () => {
    const items = [
      { id: "WB-01", targetFiles: [], verify: "node --version" },
    ];
    const completedIds = new Set(["WB-01"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, true);
  });

  it("blocks verify commands not in allowlist", () => {
    const items = [
      { id: "WB-01", targetFiles: [], verify: "echo hello" },
    ];
    const completedIds = new Set(["WB-01"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.some(f => f.includes("blocked") || f.includes("allowlist")));
  });

  it("blocks shell metacharacters in verify commands", () => {
    const items = [
      { id: "WB-01", targetFiles: [], verify: "npm test & rm -rf /" },
    ];
    const completedIds = new Set(["WB-01"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.some(f => f.includes("blocked") || f.includes("metachar") || f.includes("allowlist")));
  });

  it("blocks interpreter inline execution flags", () => {
    const blocked = [
      "node -e process.exit(0)",
      "node --eval=process.exit(0)",
      "python -c print(1)",
      "node --eval process.exit(0)",
      "node -p process.version",
      "node --print=process.version",
    ];
    for (const cmd of blocked) {
      const items = [{ id: "WB-01", targetFiles: [], verify: cmd }];
      const completedIds = new Set(["WB-01"]);
      const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
      assert.strictEqual(result.passed, false, `Expected "${cmd}" to be blocked`);
    }
  });

  it("blocks Windows %VAR% expansion in verify commands", () => {
    const items = [
      { id: "WB-01", targetFiles: [], verify: "npm test %COMSPEC%" },
    ];
    const completedIds = new Set(["WB-01"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, false);
  });
});

// ═══ 5. detectRegressions — overwrite detection ═════════════════════════

describe("detectRegressions", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
  });

  it("detects overwrite when >50% of file deleted", () => {
    // Create a file with 20 lines
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    writeFileSync(join(repo, "app.ts"), lines);
    execSync("git add app.ts && git commit -m original", { cwd: repo, stdio: "pipe" });

    // Overwrite with completely different content (simulates Write instead of Edit)
    writeFileSync(join(repo, "app.ts"), "// completely new content\nconst x = 1;\n");

    const regressions = detectRegressions(repo, ["app.ts"]);
    assert.ok(regressions.length > 0, "Should detect regression");
    assert.ok(regressions[0].includes("overwritten"), "Should mention overwrite");
  });

  it("does not flag normal edits", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    writeFileSync(join(repo, "app.ts"), lines);
    execSync("git add app.ts && git commit -m original", { cwd: repo, stdio: "pipe" });

    // Small edit: change 2 lines, add 3
    const edited = lines.replace("line 5", "modified line 5").replace("line 10", "modified line 10") + "\nnew1\nnew2\nnew3";
    writeFileSync(join(repo, "app.ts"), edited);

    const regressions = detectRegressions(repo, ["app.ts"]);
    assert.strictEqual(regressions.length, 0, "Normal edits should not trigger regression");
  });

  it("ignores new untracked files", () => {
    writeFileSync(join(repo, "new-file.ts"), "export const x = 1;");

    const regressions = detectRegressions(repo, ["new-file.ts"]);
    assert.strictEqual(regressions.length, 0);
  });

  it("handles missing files gracefully", () => {
    const regressions = detectRegressions(repo, ["nonexistent.ts"]);
    assert.strictEqual(regressions.length, 0);
  });
});

// ═══ 6. runProjectTests — project test gate ═════════════════════════

describe("runProjectTests", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
  });

  it("returns ran=false when no test command exists", () => {
    const result = runProjectTests(repo);
    assert.strictEqual(result.ran, false);
  });

  it("runs npm test when package.json has test script", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test-proj",
      scripts: { test: "echo test-passed" },
    }));
    const result = runProjectTests(repo);
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.passed, true);
  });

  it("detects npm test failure", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test-proj",
      scripts: { test: "exit 1" },
    }));
    const result = runProjectTests(repo);
    assert.strictEqual(result.ran, true);
    assert.strictEqual(result.passed, false);
  });

  it("skips default npm test placeholder", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test-proj",
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    }));
    // The "no test" pattern should be skipped
    const result = runProjectTests(repo);
    assert.strictEqual(result.ran, false);
  });
});

// ═══ 7. scanForStubs — anti-pattern detection ═══════════════════════

describe("scanForStubs", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
  });

  it("detects TODO markers", () => {
    writeFileSync(join(repo, "src/app.ts"), "function init() {\n  // TODO: implement\n}\n");
    const stubs = scanForStubs(repo, ["src/app.ts"]);
    assert.ok(stubs.length > 0);
    assert.ok(stubs[0].includes("TODO"));
  });

  it("detects FIXME markers", () => {
    writeFileSync(join(repo, "src/util.ts"), "export const x = 1; // FIXME broken\n");
    const stubs = scanForStubs(repo, ["src/util.ts"]);
    assert.ok(stubs.length > 0);
    assert.ok(stubs[0].includes("FIXME"));
  });

  it("detects empty arrow functions", () => {
    writeFileSync(join(repo, "src/handler.ts"), "const onClick = () => {};\n");
    const stubs = scanForStubs(repo, ["src/handler.ts"]);
    assert.ok(stubs.length > 0);
    assert.ok(stubs[0].includes("empty arrow"));
  });

  it("detects placeholder keyword", () => {
    writeFileSync(join(repo, "src/data.ts"), 'const name = "placeholder value";\n');
    const stubs = scanForStubs(repo, ["src/data.ts"]);
    assert.ok(stubs.length > 0);
    assert.ok(stubs[0].includes("placeholder"));
  });

  it("does not flag clean code", () => {
    writeFileSync(join(repo, "src/clean.ts"), [
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n"));
    const stubs = scanForStubs(repo, ["src/clean.ts"]);
    assert.strictEqual(stubs.length, 0);
  });

  it("skips test files", () => {
    writeFileSync(join(repo, "src/app.test.ts"), "// TODO: add more tests\n");
    const stubs = scanForStubs(repo, ["src/app.test.ts"]);
    assert.strictEqual(stubs.length, 0, "Test files should be excluded from stub scan");
  });

  it("skips lines with scan-ignore pragma", () => {
    writeFileSync(join(repo, "src/patterns.ts"), "const re = /TODO/; // scan-ignore\n");
    const stubs = scanForStubs(repo, ["src/patterns.ts"]);
    assert.strictEqual(stubs.length, 0, "scan-ignore should suppress findings");
  });

  it("detects not implemented throw", () => {
    writeFileSync(join(repo, "src/service.ts"), 'throw new Error("not implemented yet");\n');
    const stubs = scanForStubs(repo, ["src/service.ts"]);
    assert.ok(stubs.length > 0);
    assert.ok(stubs[0].includes("not implemented"));
  });
});

// ═══ 8. detectFileScopeViolations — out-of-scope file detection ═══════

describe("detectFileScopeViolations", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
  });

  it("detects files changed outside targetFiles", () => {
    // Create and commit baseline
    writeFileSync(join(repo, "src/a.ts"), "const a = 1;\n");
    writeFileSync(join(repo, "src/b.ts"), "const b = 1;\n");
    writeFileSync(join(repo, "src/c.ts"), "const c = 1;\n");
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });

    // Modify b.ts and c.ts (only b.ts is in targetFiles)
    writeFileSync(join(repo, "src/b.ts"), "const b = 2;\n");
    writeFileSync(join(repo, "src/c.ts"), "const c = 2;\n");

    const items = [{ id: "WB-1", targetFiles: ["src/b.ts"], dependsOn: [] }];
    const violations = detectFileScopeViolations(repo, items, getChangedFiles(repo, "HEAD"));
    assert.ok(violations.length > 0, "Should detect src/c.ts as out-of-scope");
    assert.ok(violations.some(v => v.includes("src/c.ts")), "Should mention src/c.ts");
  });

  it("allows .json and .md files (non-source)", () => {
    writeFileSync(join(repo, "package.json"), '{"a": 1}\n');
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });
    writeFileSync(join(repo, "package.json"), '{"a": 2}\n');

    const items = [{ id: "WB-1", targetFiles: ["src/x.ts"], dependsOn: [] }];
    const violations = detectFileScopeViolations(repo, items, getChangedFiles(repo, "HEAD"));
    assert.ok(!violations.some(v => v.includes("package.json")), "JSON files should be allowed");
  });

  it("returns empty when all changes are in scope", () => {
    writeFileSync(join(repo, "src/a.ts"), "const a = 1;\n");
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });
    writeFileSync(join(repo, "src/a.ts"), "const a = 2;\n");

    const items = [{ id: "WB-1", targetFiles: ["src/a.ts"], dependsOn: [] }];
    const violations = detectFileScopeViolations(repo, items, getChangedFiles(repo, "HEAD"));
    assert.strictEqual(violations.length, 0);
  });
});

// ═══ 9. scanBlueprintViolations — naming rule enforcement ═══════════

describe("scanBlueprintViolations", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
  });

  it("detects naming rule violations", () => {
    writeFileSync(join(repo, "src/player.ts"), "class AudioPlayer {\n  play() {}\n}\n");

    const rules = [{
      concept: "Audio Engine",
      name: "AudioEngine",
      rationale: "Blueprint naming",
      source: "design/blueprint.md",
      violationPattern: /\bAudioPlayer\b/,
      alternatives: ["AudioPlayer", "SoundPlayer"],
    }];

    const violations = scanBlueprintViolations(repo, ["src/player.ts"], rules);
    assert.ok(violations.length > 0, "Should detect AudioPlayer as violation");
    assert.ok(violations[0].includes("Audio Engine"), "Should mention concept");
    assert.ok(violations[0].includes("AudioEngine"), "Should mention expected name");
  });

  it("returns empty when code is compliant", () => {
    writeFileSync(join(repo, "src/engine.ts"), "class AudioEngine {\n  play() {}\n}\n");

    const rules = [{
      concept: "Audio Engine",
      name: "AudioEngine",
      rationale: "Blueprint naming",
      source: "design/blueprint.md",
      violationPattern: /\bAudioPlayer\b/,
      alternatives: ["AudioPlayer"],
    }];

    const violations = scanBlueprintViolations(repo, ["src/engine.ts"], rules);
    assert.strictEqual(violations.length, 0, "Compliant code should have no violations");
  });

  it("skips test files", () => {
    writeFileSync(join(repo, "src/player.test.ts"), "const player = new AudioPlayer();\n");

    const rules = [{
      concept: "Audio Engine",
      name: "AudioEngine",
      rationale: "Blueprint naming",
      source: "design/blueprint.md",
      violationPattern: /\bAudioPlayer\b/,
      alternatives: ["AudioPlayer"],
    }];

    const violations = scanBlueprintViolations(repo, ["src/player.test.ts"], rules);
    assert.strictEqual(violations.length, 0, "Test files should be excluded");
  });

  it("skips scan-ignore lines", () => {
    writeFileSync(join(repo, "src/legacy.ts"), "const player = new AudioPlayer(); // scan-ignore\n");

    const rules = [{
      concept: "Audio Engine",
      name: "AudioEngine",
      rationale: "Blueprint naming",
      source: "design/blueprint.md",
      violationPattern: /\bAudioPlayer\b/,
      alternatives: ["AudioPlayer"],
    }];

    const violations = scanBlueprintViolations(repo, ["src/legacy.ts"], rules);
    assert.strictEqual(violations.length, 0, "scan-ignore should suppress violations");
  });
});

// ═══ 10. detectOrphanFiles — wiring verification ═══════════════════

describe("detectOrphanFiles", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
    mkdirSync(join(repo, "src", "utils"), { recursive: true });
  });

  it("detects files never imported", () => {
    writeFileSync(join(repo, "src/app.ts"), 'import { helper } from "./utils/helper";\n');
    writeFileSync(join(repo, "src/utils/helper.ts"), "export function helper() {}\n");
    writeFileSync(join(repo, "src/utils/orphan.ts"), "export function orphan() {}\n");

    const orphans = detectOrphanFiles(repo, ["src/utils/orphan.ts", "src/utils/helper.ts"]);
    assert.ok(orphans.includes("src/utils/orphan.ts"), "orphan.ts should be detected");
    assert.ok(!orphans.includes("src/utils/helper.ts"), "helper.ts is imported — not orphan");
  });

  it("excludes index/main/app entry points", () => {
    writeFileSync(join(repo, "src/index.ts"), "console.log('entry');\n");

    const orphans = detectOrphanFiles(repo, ["src/index.ts"]);
    assert.strictEqual(orphans.length, 0, "index.ts is an entry point — not orphan");
  });

  it("excludes test files", () => {
    writeFileSync(join(repo, "src/utils/helper.test.ts"), "// test\n");

    const orphans = detectOrphanFiles(repo, ["src/utils/helper.test.ts"]);
    assert.strictEqual(orphans.length, 0, "test files should be excluded");
  });

  it("returns empty when all files are imported", () => {
    writeFileSync(join(repo, "src/app.ts"), [
      'import { a } from "./utils/a";',
      'import { b } from "./utils/b";',
    ].join("\n") + "\n");
    writeFileSync(join(repo, "src/utils/a.ts"), "export const a = 1;\n");
    writeFileSync(join(repo, "src/utils/b.ts"), "export const b = 2;\n");

    const orphans = detectOrphanFiles(repo, ["src/utils/a.ts", "src/utils/b.ts"]);
    assert.strictEqual(orphans.length, 0, "All files are imported — no orphans");
  });
});

// ═══ 11. scanForPerfAntiPatterns — performance anti-pattern detection ══

describe("scanForPerfAntiPatterns", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
  });

  it("detects while(true) busy loop", () => {
    writeFileSync(join(repo, "src/loop.ts"), "while (true) { doWork(); }\n");
    const findings = scanForPerfAntiPatterns(repo, ["src/loop.ts"]);
    assert.ok(findings.length > 0, "Should detect while(true)");
    assert.ok(findings[0].includes("busy loop"), "Should mention busy loop");
  });

  it("detects unbounded findAll()", () => {
    writeFileSync(join(repo, "src/db.ts"), "const all = db.findAll();\n");
    const findings = scanForPerfAntiPatterns(repo, ["src/db.ts"]);
    assert.ok(findings.length > 0, "Should detect findAll()");
    assert.ok(findings[0].includes("pagination"), "Should mention pagination");
  });

  it("does not flag clean code", () => {
    writeFileSync(join(repo, "src/clean.ts"), [
      "const items = list.filter(x => x.active);",
      "for (const item of items) { process(item); }",
    ].join("\n"));
    const findings = scanForPerfAntiPatterns(repo, ["src/clean.ts"]);
    assert.strictEqual(findings.length, 0);
  });

  it("skips test files", () => {
    writeFileSync(join(repo, "src/perf.test.ts"), "while (true) { break; }\n");
    const findings = scanForPerfAntiPatterns(repo, ["src/perf.test.ts"]);
    assert.strictEqual(findings.length, 0, "Test files should be excluded");
  });

  it("skips scan-ignore lines", () => {
    writeFileSync(join(repo, "src/loop.ts"), "while (true) { await tick(); } // scan-ignore\n");
    const findings = scanForPerfAntiPatterns(repo, ["src/loop.ts"]);
    assert.strictEqual(findings.length, 0, "scan-ignore should suppress");
  });
});

// ═══ 12. auditNewDependencies — license/security check ══════════════

describe("auditNewDependencies", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
  });

  it("detects newly added dependencies", () => {
    // Baseline: empty deps
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test", dependencies: {},
    }));
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });

    // Add a new dep
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test", dependencies: { "new-pkg": "^1.0.0" },
    }));

    const issues = auditNewDependencies(repo, "HEAD");
    assert.ok(issues.length > 0, "Should detect new-pkg");
    assert.ok(issues.some(i => i.includes("new-pkg")), "Should mention new-pkg");
  });

  it("returns empty when no deps changed", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test", dependencies: { "existing": "^1.0.0" },
    }));
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });

    // No changes
    const issues = auditNewDependencies(repo, "HEAD");
    assert.strictEqual(issues.length, 0);
  });

  it("returns empty when no package.json exists", () => {
    const issues = auditNewDependencies(repo, "HEAD");
    assert.strictEqual(issues.length, 0);
  });
});

// ═══ 13. checkTestFileCreation — test file creation verification ════

describe("checkTestFileCreation", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
  });

  it("warns when verify has test runner but no test file created", () => {
    // Baseline
    writeFileSync(join(repo, "src/app.ts"), "const a = 1;\n");
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });

    // Agent modifies source but creates no test
    writeFileSync(join(repo, "src/app.ts"), "const a = 2;\nexport function hello() { return 'hi'; }\n");

    const items = [{
      id: "WB-1", targetFiles: ["src/app.ts"], dependsOn: [],
      verify: "npx vitest run", action: "implement hello",
    }];
    const warnings = checkTestFileCreation(repo, items, getChangedFiles(repo, "HEAD"));
    assert.ok(warnings.length > 0, "Should warn about missing test file");
    assert.ok(warnings[0].includes("WB-1"), "Should mention WB-1");
  });

  it("does not warn when test file exists", () => {
    writeFileSync(join(repo, "src/app.ts"), "const a = 1;\n");
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });

    writeFileSync(join(repo, "src/app.ts"), "const a = 2;\n");
    writeFileSync(join(repo, "src/app.test.ts"), "import { hello } from './app';\n");

    const items = [{
      id: "WB-1", targetFiles: ["src/app.ts"], dependsOn: [],
      verify: "npx vitest run",
    }];
    const warnings = checkTestFileCreation(repo, items, getChangedFiles(repo, "HEAD"));
    assert.strictEqual(warnings.length, 0, "Should not warn when test exists");
  });

  it("does not warn when no test runner in verify", () => {
    writeFileSync(join(repo, "src/app.ts"), "const a = 1;\n");
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });
    writeFileSync(join(repo, "src/app.ts"), "const a = 2;\n");

    const items = [{
      id: "WB-1", targetFiles: ["src/app.ts"], dependsOn: [],
      verify: "npx tsc --noEmit",
    }];
    const warnings = checkTestFileCreation(repo, items, getChangedFiles(repo, "HEAD"));
    assert.strictEqual(warnings.length, 0, "No test runner = no test requirement");
  });
});

// ═══ 14. checkWBConstraints — constraint enforcement ════════════════

describe("checkWBConstraints", () => {
  let repo;

  beforeEach(() => {
    repo = createTmpGitRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
  });

  it("detects 'no new dependencies' violation", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test", dependencies: {},
    }));
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });

    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test", dependencies: { "lodash": "^4.0.0" },
    }));

    const items = [{
      id: "WB-1", targetFiles: ["src/app.ts"], dependsOn: [],
      constraints: "No new dependencies allowed",
    }];
    const depIssues = auditNewDependencies(repo, "HEAD");
    const violations = checkWBConstraints(repo, items, depIssues);
    assert.ok(violations.length > 0, "Should detect dependency violation");
    assert.ok(violations[0].includes("lodash"), "Should mention lodash");
  });

  it("returns empty when constraints are met", () => {
    writeFileSync(join(repo, "package.json"), JSON.stringify({
      name: "test", dependencies: { "existing": "^1.0.0" },
    }));
    execSync("git add -A && git commit -m baseline", { cwd: repo, stdio: "pipe" });

    const items = [{
      id: "WB-1", targetFiles: ["src/app.ts"], dependsOn: [],
      constraints: "No new dependencies allowed",
    }];
    const violations = checkWBConstraints(repo, items, auditNewDependencies(repo, "HEAD"));
    assert.strictEqual(violations.length, 0);
  });

  it("returns empty when no constraints field", () => {
    const items = [{
      id: "WB-1", targetFiles: ["src/app.ts"], dependsOn: [],
    }];
    const violations = checkWBConstraints(repo, items, []);
    assert.strictEqual(violations.length, 0);
  });
});

// ═══ 15. detectFixLoopStagnation — fix loop stagnation detection ════

describe("detectFixLoopStagnation", () => {
  it("detects spinning (identical findings repeated)", () => {
    const history = [
      ["type error in foo.ts", "missing import"],
      ["type error in foo.ts", "missing import"],
    ];
    const result = detectFixLoopStagnation(history);
    assert.ok(result, "Should detect spinning");
    assert.ok(result.includes("spinning"), "Should say spinning");
  });

  it("detects oscillation (A→B→A)", () => {
    const history = [
      ["error A"],
      ["error B"],
      ["error A"],
    ];
    const result = detectFixLoopStagnation(history);
    assert.ok(result, "Should detect oscillation");
    assert.ok(result.includes("oscillation"), "Should say oscillation");
  });

  it("detects no progress (count not decreasing)", () => {
    const history = [
      ["error 1", "error 2"],
      ["error 1", "error 3"],
    ];
    const result = detectFixLoopStagnation(history);
    assert.ok(result, "Should detect no progress");
    assert.ok(result.includes("no progress"), "Should say no progress");
  });

  it("returns null when findings decrease", () => {
    const history = [
      ["error 1", "error 2", "error 3"],
      ["error 1"],
    ];
    const result = detectFixLoopStagnation(history);
    assert.strictEqual(result, null, "Decreasing findings = progress");
  });

  it("returns null for single attempt", () => {
    const history = [["error 1"]];
    const result = detectFixLoopStagnation(history);
    assert.strictEqual(result, null, "Need at least 2 attempts");
  });

  it("returns null for empty history", () => {
    assert.strictEqual(detectFixLoopStagnation([]), null);
  });
});
