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

// ═══ 1. core/context.mjs path exports ════════════════════════════════

describe("core/context.mjs path resolution", () => {
  let ctx;

  it("should import core/context.mjs without error", async () => {
    ctx = await import("../core/context.mjs");
    assert.ok(ctx, "module loaded");
  });

  it("HOOKS_DIR should point to core/ directory", () => {
    assert.ok(ctx.HOOKS_DIR, "HOOKS_DIR is defined");
    assert.ok(isAbsolute(ctx.HOOKS_DIR), "HOOKS_DIR is absolute");
    assert.equal(basename(ctx.HOOKS_DIR), "core", "HOOKS_DIR basename is 'core'");
    assert.ok(existsSync(ctx.HOOKS_DIR), "HOOKS_DIR directory exists");
  });

  it("QUORUM_ROOT should be one level above HOOKS_DIR", () => {
    assert.ok(ctx.QUORUM_ROOT, "QUORUM_ROOT is defined");
    assert.ok(isAbsolute(ctx.QUORUM_ROOT), "QUORUM_ROOT is absolute");
    const expected = resolve(ctx.HOOKS_DIR, "..");
    // Normalize to handle Windows path separators
    assert.equal(
      ctx.QUORUM_ROOT.replace(/\\/g, "/"),
      expected.replace(/\\/g, "/"),
      "QUORUM_ROOT is parent of HOOKS_DIR"
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

// ═══ 2. adapters/shared/config-resolver.mjs ═══════════════════════════

describe("adapters/shared/config-resolver.mjs", () => {
  let configResolver;

  it("should import config-resolver without error", async () => {
    configResolver = await import("../adapters/shared/config-resolver.mjs");
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

// ═══ 3. adapters/shared/repo-resolver.mjs ═════════════════════════════

describe("adapters/shared/repo-resolver.mjs", () => {
  let repoResolver;

  it("should import repo-resolver without error", async () => {
    repoResolver = await import("../adapters/shared/repo-resolver.mjs");
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
    cliRunner = await import("../core/cli-runner.mjs");
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
    trackCatalog = await import("../dist/orchestrate/planning/track-catalog.js");
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
    trackFileStore = await import("../dist/orchestrate/state/filesystem/track-file-store.js");
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

// ═══ 7. platform/core facade identity ══════════════════════════════════

describe("platform/core facade identity", () => {
  let coreCtx, platformCtx;
  let coreBridge, platformBridge;
  let coreCli, platformCli;

  it("should import core/context.mjs and platform/core/context.mjs", async () => {
    coreCtx = await import("../core/context.mjs");
    platformCtx = await import("../platform/core/context.mjs");
    assert.ok(coreCtx, "core/context.mjs loaded");
    assert.ok(platformCtx, "platform/core/context.mjs loaded");
  });

  it("HOOKS_DIR should be === equal across facade and platform", () => {
    assert.strictEqual(coreCtx.HOOKS_DIR, platformCtx.HOOKS_DIR,
      "HOOKS_DIR identity: core facade === platform implementation");
  });

  it("REPO_ROOT should be === equal across facade and platform", () => {
    assert.strictEqual(coreCtx.REPO_ROOT, platformCtx.REPO_ROOT,
      "REPO_ROOT identity: core facade === platform implementation");
  });

  it("resolvePluginPath should be === equal across facade and platform", () => {
    assert.strictEqual(coreCtx.resolvePluginPath, platformCtx.resolvePluginPath,
      "resolvePluginPath identity: core facade === platform implementation");
  });

  it("resolveReferencesDir should be === equal across facade and platform", () => {
    assert.strictEqual(coreCtx.resolveReferencesDir, platformCtx.resolveReferencesDir,
      "resolveReferencesDir identity: core facade === platform implementation");
  });

  it("should import core/bridge.mjs and platform/core/bridge.mjs", async () => {
    coreBridge = await import("../core/bridge.mjs");
    platformBridge = await import("../platform/core/bridge.mjs");
    assert.ok(coreBridge, "core/bridge.mjs loaded");
    assert.ok(platformBridge, "platform/core/bridge.mjs loaded");
  });

  it("init should be === equal across facade and platform", () => {
    assert.strictEqual(coreBridge.init, platformBridge.init,
      "init identity: core facade === platform implementation");
  });

  it("close should be === equal across facade and platform", () => {
    assert.strictEqual(coreBridge.close, platformBridge.close,
      "close identity: core facade === platform implementation");
  });

  it("should import core/cli-runner.mjs and platform/core/cli-runner.mjs", async () => {
    coreCli = await import("../core/cli-runner.mjs");
    platformCli = await import("../platform/core/cli-runner.mjs");
    assert.ok(coreCli, "core/cli-runner.mjs loaded");
    assert.ok(platformCli, "platform/core/cli-runner.mjs loaded");
  });

  it("resolveBinary should be === equal across facade and platform", () => {
    assert.strictEqual(coreCli.resolveBinary, platformCli.resolveBinary,
      "resolveBinary identity: core facade === platform implementation");
  });
});

// ═══ 8. platform/core/audit facade identity ════════════════════════════
// NOTE: core/audit/index.mjs and platform/core/audit/index.mjs have a top-level
// main() call that runs on import. We verify structural identity by reading the
// facade source and confirming it re-exports from the platform canonical path,
// rather than importing the modules (which would trigger the audit main).

describe("platform/core/audit facade identity", () => {
  it("core/audit/index.mjs should exist as a facade re-exporting from platform/core/audit/index.mjs", () => {
    const facadePath = resolve(REPO_ROOT, "core", "audit", "index.mjs");
    assert.ok(existsSync(facadePath), "core/audit/index.mjs should exist");

    const content = readFileSync(facadePath, "utf8");
    assert.ok(
      content.includes("platform/core/audit/index.mjs"),
      "facade should re-export from platform/core/audit/index.mjs"
    );
  });

  it("platform/core/audit/index.mjs should exist", () => {
    const canonicalPath = resolve(REPO_ROOT, "platform", "core", "audit", "index.mjs");
    assert.ok(existsSync(canonicalPath), "platform/core/audit/index.mjs should exist");
  });

  it("facade should re-export runRespond and deriveAuditCwd", () => {
    const content = readFileSync(resolve(REPO_ROOT, "core", "audit", "index.mjs"), "utf8");
    assert.ok(content.includes("runRespond"), "facade should re-export runRespond");
    assert.ok(content.includes("deriveAuditCwd"), "facade should re-export deriveAuditCwd");
  });
});

// ═══ 9. resolver consistency after unification ═════════════════════════

describe("resolver consistency after unification", () => {
  let ctx;

  it("should import core/context.mjs", async () => {
    ctx = await import("../core/context.mjs");
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

  it("HOOKS_DIR should contain context.mjs", () => {
    assert.ok(existsSync(resolve(ctx.HOOKS_DIR, "context.mjs")),
      `HOOKS_DIR (${ctx.HOOKS_DIR}) should contain context.mjs`);
  });

  it("QUORUM_ROOT should be the parent of HOOKS_DIR", () => {
    const expected = resolve(ctx.HOOKS_DIR, "..");
    assert.equal(
      ctx.QUORUM_ROOT.replace(/\\/g, "/"),
      expected.replace(/\\/g, "/"),
      "QUORUM_ROOT is parent of HOOKS_DIR"
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
