#!/usr/bin/env node
/**
 * Platform Path Compatibility Tests — golden baseline for PLT track.
 *
 * Captures the CURRENT state of path resolution functions that will be
 * affected by the platform/ consolidation (runtime-axes-consolidation track).
 *
 * Run: node --test tests/platform-path-compat.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ═══ 1. platform/core/context.mjs path exports ════════════════════════

describe("platform/core/context.mjs path resolution", () => {
  let ctx;

  it("should import platform/core/context.mjs without error", async () => {
    ctx = await import("../platform/core/context.mjs");
    assert.ok(ctx, "module loaded");
  });

  it("HOOKS_DIR should point to core/ directory", () => {
    assert.ok(ctx.HOOKS_DIR, "HOOKS_DIR is defined");
    assert.ok(isAbsolute(ctx.HOOKS_DIR), "HOOKS_DIR is absolute");
    assert.equal(basename(ctx.HOOKS_DIR), "core", "HOOKS_DIR basename is 'core'");
    assert.ok(existsSync(ctx.HOOKS_DIR), "HOOKS_DIR directory exists");
  });

  it("QUORUM_ROOT should be two levels above HOOKS_DIR (platform/core/)", () => {
    assert.ok(ctx.QUORUM_ROOT, "QUORUM_ROOT is defined");
    assert.ok(isAbsolute(ctx.QUORUM_ROOT), "QUORUM_ROOT is absolute");
    // HOOKS_DIR = platform/core/, QUORUM_ROOT = package root (two levels up)
    const expected = resolve(ctx.HOOKS_DIR, "..", "..");
    // Normalize to handle Windows path separators
    assert.equal(
      ctx.QUORUM_ROOT.replace(/\\/g, "/"),
      expected.replace(/\\/g, "/"),
      "QUORUM_ROOT is grandparent of HOOKS_DIR (platform/core/)"
    );
  });

  it("REPO_ROOT should be an absolute path that exists", () => {
    assert.ok(ctx.REPO_ROOT, "REPO_ROOT is defined");
    assert.ok(isAbsolute(ctx.REPO_ROOT), "REPO_ROOT is absolute");
    assert.ok(existsSync(ctx.REPO_ROOT), "REPO_ROOT directory exists");
  });

  it("PROJECT_CONFIG_DIR should end with .claude/quorum", () => {
    assert.ok(ctx.PROJECT_CONFIG_DIR, "PROJECT_CONFIG_DIR is defined");
    const normalized = ctx.PROJECT_CONFIG_DIR.replace(/\\/g, "/");
    assert.ok(
      normalized.endsWith(".claude/quorum"),
      `PROJECT_CONFIG_DIR should end with .claude/quorum, got: ${normalized}`
    );
  });

  it("resolvePluginPath should resolve templates/references/en", () => {
    assert.equal(typeof ctx.resolvePluginPath, "function", "resolvePluginPath is a function");
    const result = ctx.resolvePluginPath("templates/references/en");
    assert.ok(typeof result === "string", "returns a string");
    assert.ok(
      result.replace(/\\/g, "/").includes("templates/references/en"),
      `result should contain templates/references/en, got: ${result}`
    );
  });

  it("resolveReferencesDir should use resolvePluginPath internally", () => {
    assert.equal(typeof ctx.resolveReferencesDir, "function", "resolveReferencesDir is a function");
    const refResult = ctx.resolveReferencesDir("en");
    const pluginResult = ctx.resolvePluginPath("templates/references/en");
    assert.equal(
      refResult.replace(/\\/g, "/"),
      pluginResult.replace(/\\/g, "/"),
      "resolveReferencesDir('en') matches resolvePluginPath('templates/references/en')"
    );
  });
});

// ═══ 2. platform/adapters/shared/config-resolver.mjs ═══════════════════

describe("platform/adapters/shared/config-resolver.mjs", () => {
  let configResolver;

  it("should import config-resolver without error", async () => {
    configResolver = await import("../platform/adapters/shared/config-resolver.mjs");
    assert.ok(configResolver, "module loaded");
  });

  it("should export findConfigPath function", () => {
    assert.equal(typeof configResolver.findConfigPath, "function");
  });

  it("should export loadConfig function", () => {
    assert.equal(typeof configResolver.loadConfig, "function");
  });

  it("should export extractTags function", () => {
    assert.equal(typeof configResolver.extractTags, "function");
  });

  it("loadConfig should return object with cfg, configPath, configMissing keys", () => {
    const result = configResolver.loadConfig({ repoRoot: REPO_ROOT });
    assert.ok(result, "loadConfig returns a value");
    assert.ok("cfg" in result, "result has 'cfg' key");
    assert.ok("configPath" in result, "result has 'configPath' key");
    assert.ok("configMissing" in result, "result has 'configMissing' key");
    assert.equal(typeof result.cfg, "object", "cfg is an object");
    assert.equal(typeof result.configMissing, "boolean", "configMissing is boolean");
  });

  it("extractTags should return triggerTag, agreeTag, pendingTag", () => {
    const { cfg } = configResolver.loadConfig({ repoRoot: REPO_ROOT });
    const tags = configResolver.extractTags(cfg);
    assert.ok(tags, "extractTags returns a value");
    assert.ok("triggerTag" in tags, "has triggerTag");
    assert.ok("agreeTag" in tags, "has agreeTag");
    assert.ok("pendingTag" in tags, "has pendingTag");
    assert.equal(typeof tags.triggerTag, "string");
    assert.equal(typeof tags.agreeTag, "string");
    assert.equal(typeof tags.pendingTag, "string");
  });
});

// ═══ 3. platform/adapters/shared/repo-resolver.mjs ═══════════════════

describe("platform/adapters/shared/repo-resolver.mjs", () => {
  let repoResolver;

  it("should import repo-resolver without error", async () => {
    repoResolver = await import("../platform/adapters/shared/repo-resolver.mjs");
    assert.ok(repoResolver, "module loaded");
  });

  it("resolveRepoRoot should return an absolute path", () => {
    assert.equal(typeof repoResolver.resolveRepoRoot, "function");
    const result = repoResolver.resolveRepoRoot();
    assert.ok(typeof result === "string", "returns a string");
    assert.ok(isAbsolute(result), `should be absolute path, got: ${result}`);
  });
});

// ═══ 4. core/cli-runner.mjs exports ═══════════════════════════════════

describe("core/cli-runner.mjs", () => {
  let cliRunner;

  it("should import cli-runner without error", async () => {
    cliRunner = await import("../platform/core/cli-runner.mjs");
    assert.ok(cliRunner, "module loaded");
  });

  it("should export resolveBinary function", () => {
    assert.equal(typeof cliRunner.resolveBinary, "function", "resolveBinary is a function");
  });
});

// ═══ 5. orchestrate/planning/track-catalog (via dist) ═════════════════

describe("orchestrate/planning/track-catalog (dist)", () => {
  let trackCatalog;

  it("should import track-catalog from dist without error", async () => {
    trackCatalog = await import("../dist/platform/orchestrate/planning/track-catalog.js");
    assert.ok(trackCatalog, "module loaded");
  });

  it("should export findTracks function", () => {
    assert.equal(typeof trackCatalog.findTracks, "function");
  });

  it("should export resolveTrack function", () => {
    assert.equal(typeof trackCatalog.resolveTrack, "function");
  });

  it("should export trackRef function", () => {
    assert.equal(typeof trackCatalog.trackRef, "function");
  });
});

// ═══ 6. orchestrate/state/filesystem/track-file-store (via dist) ══════

describe("orchestrate/state/filesystem/track-file-store (dist)", () => {
  let trackFileStore;

  it("should import track-file-store from dist without error", async () => {
    trackFileStore = await import("../dist/platform/orchestrate/state/filesystem/track-file-store.js");
    assert.ok(trackFileStore, "module loaded");
  });

  it("should export resolveTrackDir function", () => {
    assert.equal(typeof trackFileStore.resolveTrackDir, "function");
  });

  it("should export resolveDesignDir function", () => {
    assert.equal(typeof trackFileStore.resolveDesignDir, "function");
  });

  it("should export resolveRTMPath function", () => {
    assert.equal(typeof trackFileStore.resolveRTMPath, "function");
  });

  it("should export resolveCheckpointDir function", () => {
    assert.equal(typeof trackFileStore.resolveCheckpointDir, "function");
  });

  it("should export resolveAgentDir function", () => {
    assert.equal(typeof trackFileStore.resolveAgentDir, "function");
  });
});

// ═══ 7. Root facade directories removed (PLT-20) ════════════════════════
// Sections 7 and 8 previously tested core/ facade identity.
// Root facades (core/bridge.mjs, core/context.mjs, etc.) have been removed.
// All canonical sources are in platform/core/.

// ═══ 9. resolver consistency after unification ═════════════════════════

describe("resolver consistency after unification", () => {
  let ctx;

  it("should import platform/core/context.mjs", async () => {
    ctx = await import("../platform/core/context.mjs");
    assert.ok(ctx, "module loaded");
  });

  it("resolvePluginPath('templates/references/en') should return an existing path", () => {
    const result = ctx.resolvePluginPath("templates/references/en");
    assert.ok(typeof result === "string", "returns a string");
    assert.ok(existsSync(result),
      `resolvePluginPath('templates/references/en') should exist, got: ${result}`);
  });

  it("resolvePluginPath('config.json') should return a path string", () => {
    const result = ctx.resolvePluginPath("config.json");
    assert.ok(typeof result === "string", "returns a string");
    // config.json may or may not exist depending on project setup
    assert.ok(result.replace(/\\/g, "/").includes("config.json"),
      `result should contain config.json, got: ${result}`);
  });

  it("resolveReferencesDir('en') should equal resolvePluginPath('templates/references/en')", () => {
    const refResult = ctx.resolveReferencesDir("en");
    const pluginResult = ctx.resolvePluginPath("templates/references/en");
    assert.equal(
      refResult.replace(/\\/g, "/"),
      pluginResult.replace(/\\/g, "/"),
      "resolveReferencesDir('en') matches resolvePluginPath('templates/references/en')"
    );
  });

  it("HOOKS_DIR should point to platform/core/ directory with runtime data", () => {
    // HOOKS_DIR now resolves to platform/core/ directly (no root core/ fallback)
    assert.ok(existsSync(resolve(ctx.HOOKS_DIR, "config.json")),
      `HOOKS_DIR (${ctx.HOOKS_DIR}) should contain config.json (runtime data)`);
    const normalized = ctx.HOOKS_DIR.replace(/\\/g, "/");
    assert.ok(normalized.endsWith("platform/core"),
      `HOOKS_DIR should end with platform/core, got: ${normalized}`);
  });

  it("QUORUM_ROOT should be the grandparent of HOOKS_DIR (platform/core/)", () => {
    const expected = resolve(ctx.HOOKS_DIR, "..", "..");
    assert.equal(
      ctx.QUORUM_ROOT.replace(/\\/g, "/"),
      expected.replace(/\\/g, "/"),
      "QUORUM_ROOT is grandparent of HOOKS_DIR (platform/core/)"
    );
  });
});

// ═══ 10. respond/retro resolution consistency ══════════════════════════

describe("respond/retro resolution consistency", () => {
  it("platform/core/respond.mjs should exist and export main", async () => {
    const respondPath = resolve(REPO_ROOT, "platform", "core", "respond.mjs");
    assert.ok(existsSync(respondPath),
      `platform/core/respond.mjs should exist at ${respondPath}`);

    const mod = await import("../platform/core/respond.mjs");
    assert.equal(typeof mod.main, "function",
      "platform/core/respond.mjs should export main as a function");
  });

  it("platform/core/retrospective.mjs should exist and export main", async () => {
    const retroPath = resolve(REPO_ROOT, "platform", "core", "retrospective.mjs");
    assert.ok(existsSync(retroPath),
      `platform/core/retrospective.mjs should exist at ${retroPath}`);

    const mod = await import("../platform/core/retrospective.mjs");
    assert.equal(typeof mod.main, "function",
      "platform/core/retrospective.mjs should export main as a function");
  });
});
