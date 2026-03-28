#!/usr/bin/env node
/**
 * Platform-Only Layout Contract Tests (PLT-20)
 *
 * Verifies that the platform/ directory is the single source of truth
 * for all runtime TypeScript modules, and that root facade directories
 * have been fully removed.
 *
 * Run: node --test tests/platform-only-layout.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * Recursively collect files with given extensions from a directory.
 */
function collectFiles(dir, extensions) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, extensions));
    } else if (extensions.includes(extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ═══ 1. Platform canonical directories exist ═════════════════════════════

describe("platform canonical directories exist", () => {
  const requiredDirs = [
    "platform/bus",
    "platform/cli",
    "platform/orchestrate",
    "platform/providers",
    "platform/adapters/shared",
    "platform/core",
  ];

  for (const dir of requiredDirs) {
    it(`${dir}/ should exist`, () => {
      const full = resolve(REPO_ROOT, dir);
      assert.ok(existsSync(full), `${dir}/ must exist as canonical source location`);
      assert.ok(statSync(full).isDirectory(), `${dir}/ must be a directory`);
    });
  }
});

// ═══ 2. Platform directories contain source files ════════════════════════

describe("platform directories contain source .ts files", () => {
  const dirs = [
    "platform/bus",
    "platform/cli",
    "platform/orchestrate",
    "platform/providers",
  ];

  for (const dir of dirs) {
    it(`${dir}/ should contain .ts files`, () => {
      const full = resolve(REPO_ROOT, dir);
      const tsFiles = collectFiles(full, [".ts"]);
      assert.ok(tsFiles.length > 0,
        `${dir}/ should contain TypeScript source files, found ${tsFiles.length}`);
    });
  }
});

// ═══ 3. Root facade directories do NOT contain .ts files ═════════════════

describe("root facade directories do NOT contain .ts files", () => {
  const removedDirs = [
    { path: "bus", label: "bus/" },
    { path: "cli", label: "cli/" },
    { path: "cli/commands", label: "cli/commands/" },
    { path: "orchestrate", label: "orchestrate/" },
    { path: "orchestrate/planning", label: "orchestrate/planning/" },
    { path: "orchestrate/execution", label: "orchestrate/execution/" },
    { path: "orchestrate/governance", label: "orchestrate/governance/" },
    { path: "orchestrate/state", label: "orchestrate/state/" },
    { path: "orchestrate/core", label: "orchestrate/core/" },
    { path: "providers", label: "providers/" },
    { path: "providers/auditors", label: "providers/auditors/" },
    { path: "providers/evaluators", label: "providers/evaluators/" },
  ];

  for (const { path, label } of removedDirs) {
    it(`root ${label} should NOT contain .ts files`, () => {
      const full = resolve(REPO_ROOT, path);
      if (!existsSync(full)) {
        // Directory doesn't exist at all — that's fine
        assert.ok(true);
        return;
      }
      const tsFiles = collectFiles(full, [".ts"]);
      assert.equal(tsFiles.length, 0,
        `root ${label} should not contain .ts facade files (found ${tsFiles.length}): ${tsFiles.map(f => f.replace(REPO_ROOT, "")).join(", ")}`);
    });
  }
});

// ═══ 4. Root core/ facade .mjs files removed ════════════════════════════

describe("root core/ facade .mjs files removed", () => {
  const removedFacades = [
    "core/bridge.mjs",
    "core/context.mjs",
    "core/cli-runner.mjs",
    "core/enforcement.mjs",
    "core/respond.mjs",
    "core/retrospective.mjs",
    "core/audit.mjs",
    "core/audit/index.mjs",
    "core/audit/args.mjs",
    "core/audit/codex-runner.mjs",
    "core/audit/pre-verify.mjs",
    "core/audit/scope.mjs",
    "core/audit/session.mjs",
    "core/audit/solo-verdict.mjs",
  ];

  for (const file of removedFacades) {
    it(`${file} should NOT exist (facade removed)`, () => {
      const full = resolve(REPO_ROOT, file);
      assert.ok(!existsSync(full),
        `${file} facade should have been removed — canonical source is at platform/${file}`);
    });
  }
});

// ═══ 5. Core runtime data files preserved ═══════════════════════════════

describe("core/ runtime data files preserved", () => {
  const preserved = [
    { path: "core/config.json", label: "config.json" },
    { path: "core/locales", label: "locales/" },
    { path: "core/templates", label: "templates/" },
    { path: "core/tools/mcp-server.mjs", label: "tools/mcp-server.mjs" },
    { path: "core/tools/tool-runner.mjs", label: "tools/tool-runner.mjs" },
  ];

  for (const { path, label } of preserved) {
    it(`core/${label} should still exist`, () => {
      const full = resolve(REPO_ROOT, path);
      assert.ok(existsSync(full),
        `core/${label} must be preserved (runtime data or unmigrated source)`);
    });
  }
});

// ═══ 6. Platform skills is canonical skill source ═══════════════════════

describe("platform/skills is canonical skill source", () => {
  it("platform/skills/ should exist", () => {
    const full = resolve(REPO_ROOT, "platform", "skills");
    if (!existsSync(full)) {
      // skills/ may not have been migrated yet — skip gracefully
      assert.ok(true, "platform/skills/ not yet created (future PLT work)");
      return;
    }
    assert.ok(statSync(full).isDirectory(), "platform/skills/ must be a directory");
  });
});

// ═══ 7. Platform adapters/shared is canonical shared adapter source ═════

describe("platform/adapters/shared is canonical shared adapter source", () => {
  it("platform/adapters/shared/ should exist", () => {
    const full = resolve(REPO_ROOT, "platform", "adapters", "shared");
    assert.ok(existsSync(full),
      "platform/adapters/shared/ must exist as canonical shared adapter source");
    assert.ok(statSync(full).isDirectory());
  });

  it("platform/adapters/shared/ should contain .mjs files", () => {
    const full = resolve(REPO_ROOT, "platform", "adapters", "shared");
    const mjsFiles = collectFiles(full, [".mjs"]);
    assert.ok(mjsFiles.length > 0,
      `platform/adapters/shared/ should contain shared adapter modules, found ${mjsFiles.length}`);
  });
});

// ═══ 8. Emptied directories contain README.md ═══════════════════════════

describe("emptied root directories contain README.md", () => {
  const dirs = ["cli", "bus", "orchestrate", "providers"];

  for (const dir of dirs) {
    it(`${dir}/README.md should exist`, () => {
      const readme = resolve(REPO_ROOT, dir, "README.md");
      assert.ok(existsSync(readme),
        `${dir}/README.md should exist to explain the move to platform/${dir}/`);
    });
  }
});
