/**
 * Tests for Output Tail Reader (SDK-7).
 *
 * Verifies cursor-based delta read adopted from Claude Code
 * Task.ts outputFile/outputOffset pattern.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, truncateSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { createCursor, tailRead, tailReadAll, hasNewContent } = await import(
  "../dist/platform/orchestrate/execution/output-tail.js"
);

let tmpDir;
before(() => { tmpDir = mkdtempSync(join(tmpdir(), "output-tail-")); });
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

// ── Cursor creation ─────────────────────────────────

describe("Output Tail — cursor creation", () => {
  it("createCursor initializes at offset 0", () => {
    const cursor = createCursor("/tmp/test.out");
    assert.equal(cursor.filePath, "/tmp/test.out");
    assert.equal(cursor.offset, 0);
    assert.equal(cursor.lastSize, 0);
    assert.equal(cursor.wasReset, false);
  });
});

// ── Delta read ──────────────────────────────────────

describe("Output Tail — delta read", () => {
  it("reads nothing from non-existent file", () => {
    const cursor = createCursor(join(tmpDir, "nonexistent.out"));
    const result = tailRead(cursor);
    assert.equal(result.content, "");
    assert.equal(result.bytesRead, 0);
    assert.equal(result.truncated, false);
  });

  it("reads full content on first read", () => {
    const path = join(tmpDir, "first.out");
    writeFileSync(path, "line 1\nline 2\n");
    const cursor = createCursor(path);
    const result = tailRead(cursor);
    assert.equal(result.content, "line 1\nline 2\n");
    assert.ok(result.bytesRead > 0);
    assert.equal(result.cursor.offset, result.bytesRead);
  });

  it("reads only new content on subsequent read", () => {
    const path = join(tmpDir, "incremental.out");
    writeFileSync(path, "line 1\n");
    const cursor = createCursor(path);
    const r1 = tailRead(cursor);
    assert.equal(r1.content, "line 1\n");

    appendFileSync(path, "line 2\nline 3\n");
    const r2 = tailRead(r1.cursor);
    assert.equal(r2.content, "line 2\nline 3\n");
    assert.ok(r2.bytesRead > 0);
  });

  it("returns empty when no new content", () => {
    const path = join(tmpDir, "static.out");
    writeFileSync(path, "done\n");
    const cursor = createCursor(path);
    const r1 = tailRead(cursor);
    const r2 = tailRead(r1.cursor);
    assert.equal(r2.content, "");
    assert.equal(r2.bytesRead, 0);
  });

  it("detects truncation and resets cursor", () => {
    const path = join(tmpDir, "truncated.out");
    writeFileSync(path, "long content that will be truncated\n");
    const cursor = createCursor(path);
    const r1 = tailRead(cursor);
    assert.ok(r1.cursor.offset > 0);

    // Truncate file to smaller size
    writeFileSync(path, "short\n");
    const r2 = tailRead(r1.cursor);
    assert.equal(r2.truncated, true);
    assert.equal(r2.content, "short\n");
    assert.equal(r2.cursor.wasReset, true);
  });

  it("respects maxBytes budget", () => {
    const path = join(tmpDir, "large.out");
    const bigContent = "x".repeat(10_000) + "\n" + "y".repeat(10_000) + "\n";
    writeFileSync(path, bigContent);
    const cursor = createCursor(path);
    const result = tailRead(cursor, 1024);
    assert.ok(result.bytesRead <= 1024, `read ${result.bytesRead} bytes, expected ≤1024`);
  });

  it("line-aligns partial reads (no broken NDJSON)", () => {
    const path = join(tmpDir, "ndjson.out");
    const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ i }) + "\n").join("");
    writeFileSync(path, lines);
    const cursor = createCursor(path);
    const result = tailRead(cursor, 256);
    // Must end with newline (line-aligned)
    assert.ok(result.content.endsWith("\n"), "must be line-aligned");
    // Each line must be valid JSON
    for (const line of result.content.trim().split("\n")) {
      assert.doesNotThrow(() => JSON.parse(line), `invalid JSON: ${line.slice(0, 50)}`);
    }
  });
});

// ── tailReadAll ─────────────────────────────────────

describe("Output Tail — tailReadAll", () => {
  it("reads all remaining content to EOF", () => {
    const path = join(tmpDir, "readall.out");
    writeFileSync(path, "first batch\n");
    const cursor = createCursor(path);
    const r1 = tailRead(cursor);

    appendFileSync(path, "second batch\nthird batch\n");
    const r2 = tailReadAll(r1.cursor);
    assert.equal(r2.content, "second batch\nthird batch\n");
  });
});

// ── hasNewContent ───────────────────────────────────

describe("Output Tail — hasNewContent", () => {
  it("returns false for non-existent file", () => {
    const cursor = createCursor(join(tmpDir, "nope.out"));
    assert.equal(hasNewContent(cursor), false);
  });

  it("returns true when file has grown", () => {
    const path = join(tmpDir, "growing.out");
    writeFileSync(path, "initial\n");
    const cursor = createCursor(path);
    assert.equal(hasNewContent(cursor), true);

    const r1 = tailRead(cursor);
    assert.equal(hasNewContent(r1.cursor), false);

    appendFileSync(path, "more\n");
    assert.equal(hasNewContent(r1.cursor), true);
  });
});

// ── Multi-iteration simulation ──────────────────────

describe("Output Tail — multi-iteration simulation", () => {
  it("simulates a polling loop reading incremental output", () => {
    const path = join(tmpDir, "poll-sim.out");
    writeFileSync(path, "");

    let cursor = createCursor(path);
    const collected = [];

    // Simulate 5 iterations of append + read
    for (let i = 0; i < 5; i++) {
      appendFileSync(path, `iteration ${i}\n`);
      const result = tailRead(cursor);
      if (result.content) collected.push(result.content.trim());
      cursor = result.cursor;
    }

    assert.equal(collected.length, 5);
    assert.equal(collected[0], "iteration 0");
    assert.equal(collected[4], "iteration 4");
  });
});
