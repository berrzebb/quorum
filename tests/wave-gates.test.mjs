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
} = await import("../dist/cli/commands/orchestrate/runner.js");

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
      { id: "WB-01", targetFiles: [], verify: "exit 1" },
    ];
    const completedIds = new Set(["WB-01"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failures.some(f => f.includes("verify failed")));
  });

  it("passes when verify command succeeds", () => {
    const items = [
      { id: "WB-01", targetFiles: [], verify: "echo ok" },
    ];
    const completedIds = new Set(["WB-01"]);

    const result = verifyPhaseCompletion(repo, "Phase1", items, completedIds);
    assert.strictEqual(result.passed, true);
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
