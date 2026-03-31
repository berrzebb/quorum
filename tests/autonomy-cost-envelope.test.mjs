#!/usr/bin/env node
/**
 * RAI-5: Cache Envelope + RAI-6: Content Replacement + RAI-7: File State Cache
 *
 * Run: node --test tests/autonomy-cost-envelope.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const {
  createCacheSafeParams,
  detectCacheBreak,
  emitCacheEvent,
  onCacheTelemetry,
} = await import("../dist/platform/autonomy/cache-envelope.js");

const {
  shouldReplace,
  replaceContent,
  fetchArtifact,
  formatReplacement,
  processContent,
  defaultReplacementConfig,
} = await import("../dist/platform/bus/content-replacement.js");

const {
  FileStateCache,
  defaultFileCacheConfig,
} = await import("../dist/platform/autonomy/file-state-cache.js");

let testDir;

beforeEach(() => {
  testDir = resolve(tmpdir(), `quorum-cost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ok */ }
});

// ═══ RAI-5: Cache Envelope ════════════════════════════

describe("RAI-5: createCacheSafeParams", () => {
  it("creates params with consistent hashes", () => {
    const p1 = createCacheSafeParams("system prompt", ["tool1", "tool2"], "opus", 0);
    const p2 = createCacheSafeParams("system prompt", ["tool1", "tool2"], "opus", 0);
    assert.equal(p1.systemPromptHash, p2.systemPromptHash);
    assert.equal(p1.toolListHash, p2.toolListHash);
    assert.ok(p1.createdAt > 0);
  });

  it("different prompts produce different hashes", () => {
    const p1 = createCacheSafeParams("prompt A", ["tool1"], "opus", 0);
    const p2 = createCacheSafeParams("prompt B", ["tool1"], "opus", 0);
    assert.notEqual(p1.systemPromptHash, p2.systemPromptHash);
  });
});

describe("RAI-5: detectCacheBreak", () => {
  it("no break when params unchanged", () => {
    const p = createCacheSafeParams("prompt", ["t1"], "opus", 0);
    const result = detectCacheBreak(p, p);
    assert.equal(result.broken, false);
    assert.equal(result.changedParam, null);
  });

  it("detects system prompt change", () => {
    const p1 = createCacheSafeParams("prompt A", ["t1"], "opus", 0);
    const p2 = createCacheSafeParams("prompt B", ["t1"], "opus", 0);
    const result = detectCacheBreak(p1, p2);
    assert.equal(result.broken, true);
    assert.equal(result.changedParam, "systemPrompt");
  });

  it("detects tool list change", () => {
    const p1 = createCacheSafeParams("prompt", ["t1"], "opus", 0);
    const p2 = createCacheSafeParams("prompt", ["t1", "t2"], "opus", 0);
    const result = detectCacheBreak(p1, p2);
    assert.equal(result.broken, true);
    assert.equal(result.changedParam, "toolList");
  });

  it("detects model change", () => {
    const p1 = createCacheSafeParams("prompt", ["t1"], "opus", 0);
    const p2 = createCacheSafeParams("prompt", ["t1"], "sonnet", 0);
    const result = detectCacheBreak(p1, p2);
    assert.equal(result.broken, true);
    assert.equal(result.changedParam, "model");
  });

  it("detects temperature change", () => {
    const p1 = createCacheSafeParams("prompt", ["t1"], "opus", 0);
    const p2 = createCacheSafeParams("prompt", ["t1"], "opus", 0.7);
    const result = detectCacheBreak(p1, p2);
    assert.equal(result.broken, true);
    assert.equal(result.changedParam, "temperature");
  });
});

describe("RAI-5: cache telemetry", () => {
  it("emits telemetry events", () => {
    const events = [];
    onCacheTelemetry((r) => events.push(r));
    const params = createCacheSafeParams("p", ["t"], "opus", 0);
    emitCacheEvent("hit", "from cache", params);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "hit");
  });
});

// ═══ RAI-6: Content Replacement ═══════════════════════

describe("RAI-6: shouldReplace", () => {
  it("returns false for small content", () => {
    const config = defaultReplacementConfig(testDir);
    assert.equal(shouldReplace("small", config), false);
  });

  it("returns true for large content", () => {
    const config = defaultReplacementConfig(testDir);
    const large = "x".repeat(15000);
    assert.equal(shouldReplace(large, config), true);
  });
});

describe("RAI-6: replaceContent", () => {
  it("persists artifact to disk and returns record", () => {
    const config = { ...defaultReplacementConfig(testDir), artifactDir: resolve(testDir, "artifacts") };
    const content = "x".repeat(20000);
    const record = replaceContent(content, "s1", config);

    assert.ok(record.artifactId);
    assert.ok(record.preview.length < content.length);
    assert.equal(record.originalSize, 20000);
    assert.ok(record.reduction > 0.5);
    assert.ok(existsSync(record.path));
  });

  it("artifact can be fetched back", () => {
    const config = { ...defaultReplacementConfig(testDir), artifactDir: resolve(testDir, "artifacts") };
    const content = "x".repeat(15000);
    const record = replaceContent(content, "s1", config);
    const fetched = fetchArtifact(record.path);
    assert.equal(fetched, content);
  });
});

describe("RAI-6: processContent", () => {
  it("passes through small content unchanged", () => {
    const config = { ...defaultReplacementConfig(testDir), artifactDir: resolve(testDir, "artifacts") };
    const result = processContent("small", "s1", config);
    assert.equal(result.replaced, false);
    assert.equal(result.content, "small");
  });

  it("replaces large content with preview", () => {
    const config = { ...defaultReplacementConfig(testDir), artifactDir: resolve(testDir, "artifacts") };
    const large = "x".repeat(20000);
    const result = processContent(large, "s1", config);
    assert.equal(result.replaced, true);
    assert.ok(result.content.includes("[Content replaced"));
    assert.ok(result.record);
    assert.ok(result.content.length < large.length);
  });
});

describe("RAI-6: formatReplacement", () => {
  it("produces prompt-friendly format", () => {
    const config = { ...defaultReplacementConfig(testDir), artifactDir: resolve(testDir, "artifacts") };
    const record = replaceContent("y".repeat(15000), "s1", config);
    const formatted = formatReplacement(record);
    assert.ok(formatted.includes("[Content replaced"));
    assert.ok(formatted.includes("truncated"));
  });
});

// ═══ RAI-7: File State Cache ══════════════════════════

describe("RAI-7: FileStateCache", () => {
  it("reads and caches file", () => {
    const filePath = resolve(testDir, "test.txt");
    writeFileSync(filePath, "hello world", "utf8");

    const cache = new FileStateCache(defaultFileCacheConfig());
    const entry = cache.read(filePath);
    assert.ok(entry);
    assert.equal(entry.content, "hello world");
    assert.equal(entry.partial, false);

    // Second read should be a cache hit
    const entry2 = cache.read(filePath);
    assert.equal(entry2.contentHash, entry.contentHash);

    const stats = cache.getStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
  });

  it("returns null for missing files", () => {
    const cache = new FileStateCache();
    const entry = cache.read(resolve(testDir, "nonexistent.txt"));
    assert.equal(entry, null);
  });

  it("revalidates stale cache by mtime", () => {
    const filePath = resolve(testDir, "revalidate.txt");
    writeFileSync(filePath, "original", "utf8");

    const cache = new FileStateCache({ ...defaultFileCacheConfig(), maxAgeMs: 50 });

    // First read
    cache.read(filePath, Date.now());

    // Wait for entry to go stale, but don't change file
    const entry2 = cache.read(filePath, Date.now() + 100);
    assert.ok(entry2);
    assert.equal(entry2.content, "original"); // revalidated, same content

    const stats = cache.getStats();
    assert.ok(stats.revalidations >= 1);
  });

  it("enforces LRU bounds", () => {
    const cache = new FileStateCache({ ...defaultFileCacheConfig(), maxEntries: 3 });

    for (let i = 0; i < 5; i++) {
      const path = resolve(testDir, `file${i}.txt`);
      writeFileSync(path, `content ${i}`, "utf8");
      cache.read(path);
    }

    const stats = cache.getStats();
    assert.ok(stats.size <= 3);
    assert.ok(stats.evictions >= 2);
  });

  it("invalidates specific entry", () => {
    const filePath = resolve(testDir, "invalidate.txt");
    writeFileSync(filePath, "content", "utf8");

    const cache = new FileStateCache();
    cache.read(filePath);
    cache.invalidate(filePath);

    const stats = cache.getStats();
    assert.equal(stats.size, 0);
  });

  it("clears all entries", () => {
    const cache = new FileStateCache();
    for (let i = 0; i < 3; i++) {
      const path = resolve(testDir, `clear${i}.txt`);
      writeFileSync(path, `c${i}`, "utf8");
      cache.read(path);
    }
    cache.clear();
    assert.equal(cache.getStats().size, 0);
  });
});
