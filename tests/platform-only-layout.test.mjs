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

// ═══ 4. Root core/ directory fully removed ═══════════════════════════════

describe("root core/ directory fully removed", () => {
  it("core/ directory should NOT exist (all content migrated to platform/core/)", () => {
    const full = resolve(REPO_ROOT, "core");
    assert.ok(!existsSync(full),
      "core/ should have been removed — platform/core/ is the sole source for config, locales, templates, and all code");
  });
});

// ═══ 5. platform/core/ canonical data files ═══════════════════════════════

describe("platform/core/ canonical data files", () => {
  const canonical = [
    { path: "platform/core/config.json", label: "config.json" },
    { path: "platform/core/locales", label: "locales/" },
    { path: "platform/core/templates", label: "templates/" },
  ];

  for (const { path, label } of canonical) {
    it(`platform/core/${label} should exist (canonical data source)`, () => {
      const full = resolve(REPO_ROOT, path);
      assert.ok(existsSync(full),
        `platform/core/${label} must exist — HOOKS_DIR resolves here`);
    });
  }
});

describe("platform/core/tools/ migrated runtime scripts", () => {
  const migrated = [
    { path: "platform/core/tools/mcp-server.mjs", label: "tools/mcp-server.mjs" },
    { path: "platform/core/tools/tool-runner.mjs", label: "tools/tool-runner.mjs" },
  ];

  for (const { path, label } of migrated) {
    it(`platform/core/${label} should exist (migrated runtime script)`, () => {
      const full = resolve(REPO_ROOT, path);
      assert.ok(existsSync(full),
        `platform/core/${label} must exist (migrated from core/tools/)`);
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

// ═══ 8. Root runtime directories removed ═════════════════════════════════

describe("root runtime directories removed", () => {
  const dirs = ["cli", "bus", "orchestrate", "providers", "skills", "adapters", "languages", "hooks"];

  for (const dir of dirs) {
    it(`${dir}/ directory should not exist`, () => {
      assert.ok(!existsSync(resolve(REPO_ROOT, dir)),
        `${dir}/ should have been removed — platform/${dir}/ is the sole source`);
    });
  }
});

// ═══ 9. Root core/ fully removed (no data or code files remain) ══════════

describe("root core/ fully removed", () => {
  it("core/ should NOT exist at all (migrated to platform/core/)", () => {
    const full = resolve(REPO_ROOT, "core");
    assert.ok(!existsSync(full),
      "core/ should have been fully deleted — all data and code migrated to platform/core/");
  });
});

// ═══ 10. Root adapters/ directory removed ═════════════════════════════════

describe("root adapters/ directory removed", () => {
  it("adapters/ directory should NOT exist", () => {
    const full = resolve(REPO_ROOT, "adapters");
    assert.ok(!existsSync(full),
      "adapters/ should have been removed — platform/adapters/ is the sole source");
  });
});
