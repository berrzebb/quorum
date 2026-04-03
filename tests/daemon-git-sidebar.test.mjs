#!/usr/bin/env node
/**
 * DUX-12: Git sidebar state management tests.
 *
 * Tests: emptyGitSnapshot, parseGitLog, parseChangedFiles, GitSidebarState.
 * Scroll independence acceptance criteria from implementation-notes-dux-7-12.md §10.5.
 *
 * Run: node --test tests/daemon-git-sidebar.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";

// Import from compiled output
const MOD_PATH = "../dist/daemon/panels/sessions/git-state.js";

// ═══ 1. emptyGitSnapshot ════════════════════════════════════════════

describe("DUX-12: emptyGitSnapshot", () => {
  it("returns empty arrays and zero offsets", async () => {
    const { emptyGitSnapshot } = await import(MOD_PATH);
    const snap = emptyGitSnapshot();
    assert.deepStrictEqual(snap.commits, []);
    assert.deepStrictEqual(snap.changedFiles, []);
    assert.equal(snap.commitScrollOffset, 0);
    assert.equal(snap.filesScrollOffset, 0);
  });
});

// ═══ 2. parseGitLog ═════════════════════════════════════════════════

describe("DUX-12: parseGitLog", () => {
  it("parses standard git log output", async () => {
    const { parseGitLog } = await import(MOD_PATH);
    const lines = [
      "* abc1234 (HEAD -> main) initial commit",
      "* def5678 second commit",
    ];
    const commits = parseGitLog(lines);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].sha, "abc1234");
    assert.equal(commits[0].summary, "(HEAD -> main) initial commit");
    assert.equal(commits[1].sha, "def5678");
    assert.equal(commits[1].summary, "second commit");
  });

  it("extracts graph prefix", async () => {
    const { parseGitLog } = await import(MOD_PATH);
    const lines = [
      "* abc1234 commit msg",
      "| * def5678 branch commit",
    ];
    const commits = parseGitLog(lines);
    assert.equal(commits[0].graph, "*");
    assert.equal(commits[1].graph, "| *");
  });

  it("handles empty lines", async () => {
    const { parseGitLog } = await import(MOD_PATH);
    const lines = [
      "* abc1234 commit one",
      "",
      "   ",
      "* def5678 commit two",
    ];
    const commits = parseGitLog(lines);
    assert.equal(commits.length, 2);
  });

  it("handles lines without SHA (pure graph lines)", async () => {
    const { parseGitLog } = await import(MOD_PATH);
    const lines = [
      "|\\",
      "| |",
      "* abc1234 real commit",
    ];
    const commits = parseGitLog(lines);
    assert.equal(commits.length, 3);
    // Pure graph lines get empty SHA
    assert.equal(commits[0].sha, "");
    assert.equal(commits[0].graph, "|\\");
    assert.equal(commits[1].sha, "");
    assert.equal(commits[2].sha, "abc1234");
  });

  it("handles full-length SHA", async () => {
    const { parseGitLog } = await import(MOD_PATH);
    const sha40 = "a".repeat(40);
    const lines = [`* ${sha40} full sha commit`];
    const commits = parseGitLog(lines);
    assert.equal(commits[0].sha, sha40);
    assert.equal(commits[0].summary, "full sha commit");
  });
});

// ═══ 3. parseChangedFiles ═══════════════════════════════════════════

describe("DUX-12: parseChangedFiles", () => {
  it("parses git status output with M, A, D, R, ?", async () => {
    const { parseChangedFiles } = await import(MOD_PATH);
    const lines = [
      "M src/app.ts",
      "A src/new.ts",
      "D src/old.ts",
      "R src/renamed.ts",
      "? untracked.txt",
    ];
    const files = parseChangedFiles(lines);
    assert.equal(files.length, 5);
    assert.equal(files[0].status, "M");
    assert.equal(files[0].path, "src/app.ts");
    assert.equal(files[1].status, "A");
    assert.equal(files[2].status, "D");
    assert.equal(files[3].status, "R");
    assert.equal(files[4].status, "?");
  });

  it("unknown status falls back to '?'", async () => {
    const { parseChangedFiles } = await import(MOD_PATH);
    const lines = ["X weird/file.ts"];
    const files = parseChangedFiles(lines);
    assert.equal(files[0].status, "?");
    assert.equal(files[0].path, "weird/file.ts");
  });

  it("handles empty lines", async () => {
    const { parseChangedFiles } = await import(MOD_PATH);
    const lines = ["M file.ts", "", "  ", "A other.ts"];
    const files = parseChangedFiles(lines);
    assert.equal(files.length, 2);
  });
});

// ═══ 4. GitSidebarState ═════════════════════════════════════════════

describe("DUX-12: GitSidebarState", () => {
  let GitSidebarState;

  beforeEach(async () => {
    const mod = await import(MOD_PATH);
    GitSidebarState = mod.GitSidebarState;
  });

  it("initial snapshot is empty", () => {
    const state = new GitSidebarState();
    const snap = state.getSnapshot();
    assert.deepStrictEqual(snap.commits, []);
    assert.deepStrictEqual(snap.changedFiles, []);
    assert.equal(snap.commitScrollOffset, 0);
    assert.equal(snap.filesScrollOffset, 0);
  });

  it("updateData sets commits and files", () => {
    const state = new GitSidebarState();
    const commits = [{ sha: "aaa", graph: "*", summary: "msg" }];
    const files = [{ path: "f.ts", status: /** @type {const} */ ("M") }];
    state.updateData(commits, files);
    const snap = state.getSnapshot();
    assert.equal(snap.commits.length, 1);
    assert.equal(snap.changedFiles.length, 1);
  });

  it("updateData does NOT reset scroll offsets", () => {
    const state = new GitSidebarState();
    // Set initial data with enough items
    const commits = Array.from({ length: 20 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `file${i}.ts`, status: /** @type {const} */ ("M"),
    }));
    state.updateData(commits, files);

    // Scroll both
    state.scrollCommits(5);
    state.scrollFiles(3);
    assert.equal(state.getSnapshot().commitScrollOffset, 5);
    assert.equal(state.getSnapshot().filesScrollOffset, 3);

    // Update data with same-size arrays — offsets preserved
    const commits2 = Array.from({ length: 20 }, (_, i) => ({
      sha: `new${i}`, graph: "*", summary: `new commit ${i}`,
    }));
    const files2 = Array.from({ length: 10 }, (_, i) => ({
      path: `new${i}.ts`, status: /** @type {const} */ ("A"),
    }));
    state.updateData(commits2, files2);
    assert.equal(state.getSnapshot().commitScrollOffset, 5);
    assert.equal(state.getSnapshot().filesScrollOffset, 3);
  });

  it("updateData clamps scroll to valid range when data shrinks", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 20 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    state.updateData(commits, []);
    state.scrollCommits(15);
    assert.equal(state.getSnapshot().commitScrollOffset, 15);

    // Shrink to 5 items — offset clamped to 4 (length - 1)
    const smallCommits = Array.from({ length: 5 }, (_, i) => ({
      sha: `s${i}`, graph: "*", summary: `c${i}`,
    }));
    state.updateData(smallCommits, []);
    assert.equal(state.getSnapshot().commitScrollOffset, 4);
  });

  it("scrollCommits by positive delta", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    state.updateData(commits, []);
    state.scrollCommits(3);
    assert.equal(state.getSnapshot().commitScrollOffset, 3);
  });

  it("scrollCommits by negative delta", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    state.updateData(commits, []);
    state.scrollCommits(5);
    state.scrollCommits(-2);
    assert.equal(state.getSnapshot().commitScrollOffset, 3);
  });

  it("scrollCommits clamps to 0", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    state.updateData(commits, []);
    state.scrollCommits(3);
    state.scrollCommits(-100);
    assert.equal(state.getSnapshot().commitScrollOffset, 0);
  });

  it("scrollCommits clamps to max", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    state.updateData(commits, []);
    state.scrollCommits(999);
    assert.equal(state.getSnapshot().commitScrollOffset, 9); // length - 1
  });

  it("scrollFiles independent from scrollCommits", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `file${i}.ts`, status: /** @type {const} */ ("M"),
    }));
    state.updateData(commits, files);

    state.scrollCommits(5);
    state.scrollFiles(3);
    assert.equal(state.getSnapshot().commitScrollOffset, 5);
    assert.equal(state.getSnapshot().filesScrollOffset, 3);

    // Scrolling commits does not affect files
    state.scrollCommits(2);
    assert.equal(state.getSnapshot().commitScrollOffset, 7);
    assert.equal(state.getSnapshot().filesScrollOffset, 3);

    // Scrolling files does not affect commits
    state.scrollFiles(1);
    assert.equal(state.getSnapshot().commitScrollOffset, 7);
    assert.equal(state.getSnapshot().filesScrollOffset, 4);
  });

  it("jumpCommits('top') sets offset to 0", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    state.updateData(commits, []);
    state.scrollCommits(7);
    state.jumpCommits("top");
    assert.equal(state.getSnapshot().commitScrollOffset, 0);
  });

  it("jumpCommits('bottom') sets offset to max", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    state.updateData(commits, []);
    state.jumpCommits("bottom");
    assert.equal(state.getSnapshot().commitScrollOffset, 9);
  });

  it("jumpFiles independent from jumpCommits", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    const files = Array.from({ length: 6 }, (_, i) => ({
      path: `f${i}.ts`, status: /** @type {const} */ ("A"),
    }));
    state.updateData(commits, files);

    state.jumpCommits("bottom");
    state.jumpFiles("bottom");
    assert.equal(state.getSnapshot().commitScrollOffset, 9);
    assert.equal(state.getSnapshot().filesScrollOffset, 5);

    state.jumpCommits("top");
    assert.equal(state.getSnapshot().commitScrollOffset, 0);
    assert.equal(state.getSnapshot().filesScrollOffset, 5); // unchanged
  });
});

// ═══ 5. Scroll independence acceptance criteria (§10.5) ═════════════

describe("DUX-12: Scroll independence", () => {
  let GitSidebarState;

  beforeEach(async () => {
    const mod = await import(MOD_PATH);
    GitSidebarState = mod.GitSidebarState;
  });

  it("scroll commit graph then interact with files — commit offset preserved", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 20 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `f${i}.ts`, status: /** @type {const} */ ("M"),
    }));
    state.updateData(commits, files);

    // Scroll commit graph
    state.scrollCommits(8);
    assert.equal(state.getSnapshot().commitScrollOffset, 8);

    // Switch to files (scroll files)
    state.scrollFiles(4);
    assert.equal(state.getSnapshot().filesScrollOffset, 4);

    // Commit offset must be preserved
    assert.equal(state.getSnapshot().commitScrollOffset, 8);
  });

  it("scroll files then interact with transcript (simulated) — files offset preserved", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `f${i}.ts`, status: /** @type {const} */ ("A"),
    }));
    state.updateData(commits, files);

    // Scroll files
    state.scrollFiles(5);
    assert.equal(state.getSnapshot().filesScrollOffset, 5);

    // Simulate "switching to transcript" — no method on GitSidebarState touches
    // the transcript, so simply read the snapshot to confirm offset is preserved
    const snap = state.getSnapshot();
    assert.equal(snap.filesScrollOffset, 5);
    assert.equal(snap.commitScrollOffset, 0);
  });

  it("transcript, commit graph, and changed files never reset each other's scroll", () => {
    const state = new GitSidebarState();
    const commits = Array.from({ length: 15 }, (_, i) => ({
      sha: `sha${i}`, graph: "*", summary: `commit ${i}`,
    }));
    const files = Array.from({ length: 12 }, (_, i) => ({
      path: `f${i}.ts`, status: /** @type {const} */ ("M"),
    }));
    state.updateData(commits, files);

    // Set distinct offsets
    state.scrollCommits(7);
    state.scrollFiles(4);

    // Verify both
    assert.equal(state.getSnapshot().commitScrollOffset, 7);
    assert.equal(state.getSnapshot().filesScrollOffset, 4);

    // Interleaved operations
    state.scrollCommits(2);   // commits: 9
    state.scrollFiles(-1);    // files: 3
    state.jumpCommits("top"); // commits: 0
    state.scrollFiles(2);     // files: 5

    assert.equal(state.getSnapshot().commitScrollOffset, 0);
    assert.equal(state.getSnapshot().filesScrollOffset, 5);

    // Jump files to bottom should not touch commits
    state.jumpFiles("bottom");
    assert.equal(state.getSnapshot().commitScrollOffset, 0);
    assert.equal(state.getSnapshot().filesScrollOffset, 11);
  });
});
