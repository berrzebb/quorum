#!/usr/bin/env node
/**
 * Knowledge-Centric Skill Architecture Tests — v0.6.0.
 *
 * Verifies the new architecture from platform/skills/ARCHITECTURE.md:
 * - Core skill manifests exist (11 skills)
 * - Each manifest references knowledge protocols
 * - Knowledge base structure is complete
 * - platform/adapters/shared/ contains key modules
 *
 * Run: node --test tests/adapter-wrapper-compat.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = resolve(REPO_ROOT, "platform", "skills");
const KNOWLEDGE_DIR = resolve(REPO_ROOT, "agents", "knowledge");

const CORE_SKILLS = [
  "audit",
  "consensus-tools",
  "designer",
  "fde-analyst",
  "harness-bootstrap",
  "merge-worktree",
  "orchestrator",
  "planner",
  "status",
  "verify",
  "wb-parser",
];

// ═══ 1. Core skill manifests ══════════════════════════════════════════

describe("skill architecture — core manifests", () => {
  it(`should have exactly ${CORE_SKILLS.length} core skills`, () => {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .filter(e => existsSync(resolve(SKILLS_DIR, e.name, "SKILL.md")))
      .map(e => e.name);
    assert.deepEqual(dirs.sort(), [...CORE_SKILLS].sort());
  });

  for (const skill of CORE_SKILLS) {
    it(`${skill}/SKILL.md should exist and be a lightweight manifest`, () => {
      const path = resolve(SKILLS_DIR, skill, "SKILL.md");
      assert.ok(existsSync(path), `${path} should exist`);
      const content = readFileSync(path, "utf8");
      const lines = content.split("\n").length;
      assert.ok(lines <= 40, `${skill}/SKILL.md should be <= 40 lines (manifest), got ${lines}`);
    });

    it(`${skill}/SKILL.md should reference knowledge protocol`, () => {
      const path = resolve(SKILLS_DIR, skill, "SKILL.md");
      const content = readFileSync(path, "utf8");
      assert.ok(
        content.includes("agents/knowledge/"),
        `${skill}/SKILL.md should reference agents/knowledge/`
      );
    });
  }
});

// ═══ 2. Knowledge base structure ═════════════════════════════════════

describe("skill architecture — knowledge base", () => {
  it("agents/knowledge/protocols/ should exist with protocols", () => {
    const protocolsDir = resolve(KNOWLEDGE_DIR, "protocols");
    assert.ok(existsSync(protocolsDir));
    const files = readdirSync(protocolsDir).filter(f => f.endsWith(".md"));
    assert.ok(files.length >= 20, `Expected >= 20 protocols, got ${files.length}`);
  });

  it("agents/knowledge/domains/ should exist with 11 domains", () => {
    const domainsDir = resolve(KNOWLEDGE_DIR, "domains");
    assert.ok(existsSync(domainsDir));
    const files = readdirSync(domainsDir).filter(f => f.endsWith(".md"));
    assert.equal(files.length, 11, `Expected 11 domains, got ${files.length}`);
  });

  it("agents/knowledge/tools/inventory.md should exist", () => {
    assert.ok(existsSync(resolve(KNOWLEDGE_DIR, "tools", "inventory.md")));
  });

  it("agents/knowledge/references/ should exist with reference material", () => {
    const refsDir = resolve(KNOWLEDGE_DIR, "references");
    assert.ok(existsSync(refsDir));
    const subdirs = readdirSync(refsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    assert.ok(subdirs.length >= 5, `Expected >= 5 reference categories, got ${subdirs.length}`);
  });

  it("agents/knowledge/README.md should exist", () => {
    assert.ok(existsSync(resolve(KNOWLEDGE_DIR, "README.md")));
  });
});

// ═══ 3. No adapter wrappers (v0.6.0 — dynamic resolution) ══════════

describe("skill architecture — no static adapter wrappers", () => {
  const ADAPTER_NAMES = ["claude-code", "codex", "gemini", "openai-compatible"];

  for (const adapter of ADAPTER_NAMES) {
    it(`platform/adapters/${adapter}/skills/ should not exist`, () => {
      const skillsPath = resolve(REPO_ROOT, "platform", "adapters", adapter, "skills");
      assert.ok(
        !existsSync(skillsPath),
        `${skillsPath} should not exist — adapter wrappers are dynamically resolved`
      );
    });
  }
});

// ═══ 4. platform/adapters/shared/ canonical source ═══════════════════

describe("skill architecture — shared modules", () => {
  const PLATFORM_SHARED_DIR = resolve(REPO_ROOT, "platform", "adapters", "shared");

  it("platform/adapters/shared/ directory should exist", () => {
    assert.ok(existsSync(PLATFORM_SHARED_DIR));
  });

  const requiredFiles = [
    "config-resolver.mjs",
    "repo-resolver.mjs",
    "hook-runner.mjs",
    "cli-adapter.mjs",
    "tool-names.mjs",
  ];

  for (const file of requiredFiles) {
    it(`platform/adapters/shared/${file} should exist`, () => {
      assert.ok(existsSync(resolve(PLATFORM_SHARED_DIR, file)));
    });
  }
});
