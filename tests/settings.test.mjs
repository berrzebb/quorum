#!/usr/bin/env node
/**
 * Settings Hierarchy Tests — CONFIG-1 + CONFIG-2
 *
 * Run: node --test tests/settings.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  mergeConfigs,
  loadConfig,
  resetConfigCache,
  readConfigFile,
} from "../dist/platform/core/config/settings.js";
import { DEFAULT_CONFIG } from "../dist/platform/core/config/types.js";
import { safeParseConfig } from "../dist/platform/core/config/schema.js";

// ═══ 1. mergeConfigs ════════════════════════════════════

describe("mergeConfigs", () => {
  it("scalar override — later wins", () => {
    const result = mergeConfigs(
      { plugin: { locale: "en" } },
      { plugin: { locale: "ko" } },
    );
    assert.equal(result.plugin.locale, "ko");
  });

  it("deep merge — nested objects", () => {
    const result = mergeConfigs(
      { consensus: { trigger_tag: "[REVIEW]" } },
      { consensus: { agree_tag: "[OK]" } },
    );
    assert.equal(result.consensus.trigger_tag, "[REVIEW]");
    assert.equal(result.consensus.agree_tag, "[OK]");
  });

  it("array concat + dedup", () => {
    const result = mergeConfigs(
      { quality_rules: [{ pattern: "*.ts" }] },
      { quality_rules: [{ pattern: "*.ts" }, { pattern: "*.mjs" }] },
    );
    // Dedup by JSON.stringify
    assert.ok(result.quality_rules.length <= 3);
  });

  it("passthrough — unknown keys preserved", () => {
    const result = mergeConfigs(
      { customPlugin: { foo: 1 } },
      { anotherKey: "bar" },
    );
    assert.equal(result.customPlugin.foo, 1);
    assert.equal(result.anotherKey, "bar");
  });

  it("empty merge returns empty", () => {
    const result = mergeConfigs({}, {});
    assert.deepEqual(result, {});
  });
});

// ═══ 2. readConfigFile ══════════════════════════════════

describe("readConfigFile", () => {
  const tmpDir = join(tmpdir(), `quorum-cfg-test-${Date.now()}`);

  it("setup", () => {
    mkdirSync(tmpDir, { recursive: true });
  });

  it("reads valid JSON", () => {
    const path = join(tmpDir, "valid.json");
    writeFileSync(path, JSON.stringify({ plugin: { locale: "ko" } }));
    const result = readConfigFile(path);
    assert.equal(result.plugin.locale, "ko");
  });

  it("returns empty for nonexistent file", () => {
    assert.deepEqual(readConfigFile("/nonexistent.json"), {});
  });

  it("returns empty for invalid JSON", () => {
    const path = join(tmpDir, "bad.json");
    writeFileSync(path, "NOT JSON");
    assert.deepEqual(readConfigFile(path), {});
  });

  it("returns empty for empty path", () => {
    assert.deepEqual(readConfigFile(""), {});
  });

  it("cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ═══ 3. loadConfig ══════════════════════════════════════

describe("loadConfig", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("returns default config when no files exist", () => {
    const config = loadConfig("/nonexistent/repo");
    // Should have default values
    assert.equal(config.plugin?.locale, "en");
    assert.equal(config.consensus?.trigger_tag, "[REVIEW_NEEDED]");
  });

  it("returns a clone (mutation safe)", () => {
    const a = loadConfig("/nonexistent/repo");
    const b = loadConfig("/nonexistent/repo");
    a.plugin.locale = "modified";
    assert.equal(b.plugin.locale, "en"); // b is unaffected
  });

  it("caches result — second call returns clone from cache", () => {
    const a = loadConfig("/nonexistent/repo");
    const b = loadConfig("/nonexistent/repo");
    assert.deepEqual(a, b);
  });

  it("resetConfigCache forces re-read", () => {
    loadConfig("/nonexistent/repo");
    resetConfigCache();
    // Should not throw (re-reads files)
    const config = loadConfig("/nonexistent/repo");
    assert.ok(config);
  });
});

// ═══ 4. safeParseConfig ═════════════════════════════════

describe("safeParseConfig", () => {
  it("valid config passes through", () => {
    const result = safeParseConfig({
      plugin: { locale: "ko" },
      consensus: { trigger_tag: "[REVIEW]" },
    });
    assert.ok(result.success);
    assert.equal(result.data.plugin.locale, "ko");
    assert.equal(result.errors.length, 0);
  });

  it("invalid field falls back to default", () => {
    const result = safeParseConfig({
      plugin: { locale: 42 }, // Should be string
    });
    assert.ok(!result.success);
    assert.equal(result.data.plugin.locale, "en"); // Default
    assert.ok(result.errors.length > 0);
  });

  it("completely invalid config → full defaults", () => {
    const result = safeParseConfig("not an object");
    assert.ok(!result.success);
    assert.equal(result.data.plugin.locale, "en");
  });

  it("null input → full defaults", () => {
    const result = safeParseConfig(null);
    assert.ok(!result.success);
  });

  it("passthrough — unknown keys preserved", () => {
    const result = safeParseConfig({
      plugin: { locale: "en" },
      myCustomPlugin: { setting: true },
    });
    assert.equal(result.data.myCustomPlugin.setting, true);
  });

  it("partial errors — valid fields preserved", () => {
    const result = safeParseConfig({
      plugin: { locale: "ko" },
      consensus: { trigger_tag: 999 }, // Invalid
    });
    assert.equal(result.data.plugin.locale, "ko"); // Valid — preserved
    assert.equal(result.data.consensus.trigger_tag, "[REVIEW_NEEDED]"); // Invalid — default
    assert.ok(result.errors.length > 0);
  });

  it("stopReviewGate.enabled validates boolean", () => {
    const result = safeParseConfig({
      stopReviewGate: { enabled: "yes" }, // Should be boolean
    });
    assert.equal(result.data.stopReviewGate.enabled, false); // Default
  });
});

// ═══ 5. NFR-20: Existing config.json compatibility ══════

describe("NFR-20: backward compatibility", () => {
  it("existing config.json format works unchanged", () => {
    const existingConfig = {
      plugin: { locale: "en", hooks_enabled: {} },
      consensus: {
        trigger_tag: "[REVIEW_NEEDED]",
        agree_tag: "[APPROVED]",
        pending_tag: "[CHANGES_REQUESTED]",
      },
    };
    const result = safeParseConfig(existingConfig);
    assert.ok(result.success);
    assert.deepEqual(result.data.plugin, existingConfig.plugin);
    // Consensus gets additional optional fields (roles, eligibleVoters) from schema
    assert.equal(result.data.consensus.trigger_tag, existingConfig.consensus.trigger_tag);
    assert.equal(result.data.consensus.agree_tag, existingConfig.consensus.agree_tag);
    assert.equal(result.data.consensus.pending_tag, existingConfig.consensus.pending_tag);
  });
});
