#!/usr/bin/env node
/**
 * Config Advanced Tests — CONFIG-3 (change-detector), CONFIG-4 (source-tracker),
 * CONFIG-5 (drop-in), CONFIG-6 (cache)
 *
 * Run: node --test tests/config-advanced.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadConfig,
  resetConfigCache,
  mergeConfigs,
} from "../dist/platform/core/config/settings.js";
import {
  resolveSource,
  getConfigWithSources,
  getSourceDisplay,
} from "../dist/platform/core/config/source-tracker.js";
import {
  loadDropInSettings,
} from "../dist/platform/core/config/managed-settings.js";
import {
  getSessionCache,
  setSessionCache,
  clearSessionCache,
  getTierCache,
  setTierCache,
  invalidateTier,
  getContentCache,
  setContentCache,
  resetAllCaches,
} from "../dist/platform/core/config/cache.js";

// ═══ 1. Source Tracker ══════════════════════════════════

describe("source-tracker — resolveSource", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("default values → defaults tier", () => {
    loadConfig("/nonexistent/repo");
    const source = resolveSource("plugin.locale");
    assert.equal(source, "defaults");
  });

});

describe("source-tracker — getConfigWithSources", () => {
  beforeEach(() => resetConfigCache());
  afterEach(() => resetConfigCache());

  it("returns effective config + sources map", () => {
    const { effective, sources } = getConfigWithSources("/nonexistent/repo");
    assert.ok(effective.plugin);
    assert.ok(sources.size > 0);
    assert.equal(sources.get("plugin.locale"), "defaults");
  });
});

// ═══ 2. Drop-in Settings ════════════════════════════════

describe("managed-settings — loadDropInSettings", () => {
  const tmpDir = join(tmpdir(), `quorum-dropin-${Date.now()}`);

  it("setup", () => {
    mkdirSync(tmpDir, { recursive: true });
  });

  it("loads and merges files alphabetically", () => {
    writeFileSync(join(tmpDir, "00-security.json"), JSON.stringify({
      stopReviewGate: { enabled: true },
    }));
    writeFileSync(join(tmpDir, "10-quality.json"), JSON.stringify({
      gates: { essential: ["CQ", "T"] },
    }));

    const result = loadDropInSettings(tmpDir);
    assert.equal(result.stopReviewGate?.enabled, true);
    assert.deepEqual(result.gates?.essential, ["CQ", "T"]);
  });

  it("later files override earlier", () => {
    writeFileSync(join(tmpDir, "00-base.json"), JSON.stringify({
      plugin: { locale: "en" },
    }));
    writeFileSync(join(tmpDir, "10-override.json"), JSON.stringify({
      plugin: { locale: "ko" },
    }));

    const result = loadDropInSettings(tmpDir);
    assert.equal(result.plugin?.locale, "ko");
  });

  it("skips invalid JSON files", () => {
    writeFileSync(join(tmpDir, "20-broken.json"), "NOT JSON");
    writeFileSync(join(tmpDir, "30-valid.json"), JSON.stringify({
      consensus: { trigger_tag: "[CUSTOM]" },
    }));

    const result = loadDropInSettings(tmpDir);
    assert.equal(result.consensus?.trigger_tag, "[CUSTOM]");
  });

  it("returns empty for nonexistent directory", () => {
    const result = loadDropInSettings("/nonexistent/dropin");
    assert.deepEqual(result, {});
  });

  it("cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ═══ 3. Cache ═══════════════════════════════════════════

describe("config cache — session layer", () => {
  afterEach(() => resetAllCaches());

  it("null on first access", () => {
    assert.equal(getSessionCache(), null);
  });

  it("returns clone after set", () => {
    setSessionCache({ plugin: { locale: "en" } });
    const a = getSessionCache();
    const b = getSessionCache();
    assert.deepEqual(a, b);
    a.plugin.locale = "modified";
    assert.equal(getSessionCache().plugin.locale, "en"); // Unchanged
  });

  it("clear resets cache", () => {
    setSessionCache({ plugin: { locale: "ko" } });
    clearSessionCache();
    assert.equal(getSessionCache(), null);
  });
});

describe("config cache — tier layer", () => {
  afterEach(() => resetAllCaches());

  it("null on first access", () => {
    assert.equal(getTierCache("user"), null);
  });

  it("stores and retrieves tier config", () => {
    setTierCache("project", { plugin: { locale: "ko" } });
    const result = getTierCache("project");
    assert.equal(result.plugin.locale, "ko");
  });

  it("invalidateTier clears specific tier + session cache", () => {
    setTierCache("project", { plugin: { locale: "ko" } });
    setSessionCache({ plugin: { locale: "ko" } });
    invalidateTier("project");
    assert.equal(getTierCache("project"), null);
    assert.equal(getSessionCache(), null);
  });
});

describe("config cache — content layer", () => {
  afterEach(() => resetAllCaches());

  it("null on first access", () => {
    assert.equal(getContentCache("/path", "content"), null);
  });

  it("returns cached parse if content matches", () => {
    setContentCache("/path", "content", { plugin: { locale: "ko" } });
    const result = getContentCache("/path", "content");
    assert.equal(result.plugin.locale, "ko");
  });

  it("returns null if content changed", () => {
    setContentCache("/path", "old", { plugin: { locale: "ko" } });
    assert.equal(getContentCache("/path", "new"), null);
  });

  it("clone-on-return", () => {
    setContentCache("/path", "c", { plugin: { locale: "en" } });
    const a = getContentCache("/path", "c");
    a.plugin.locale = "modified";
    assert.equal(getContentCache("/path", "c").plugin.locale, "en");
  });
});

describe("config cache — resetAllCaches", () => {
  it("clears all 3 layers", () => {
    setSessionCache({ plugin: { locale: "en" } });
    setTierCache("user", { plugin: { locale: "ko" } });
    setContentCache("/path", "c", {});
    resetAllCaches();
    assert.equal(getSessionCache(), null);
    assert.equal(getTierCache("user"), null);
    assert.equal(getContentCache("/path", "c"), null);
  });
});
