#!/usr/bin/env node
/**
 * Adapter Wrapper Compatibility Tests — golden baseline for PLT track.
 *
 * Verifies the structural rules from skills/ARCHITECTURE.md:
 * - Each adapter has skill wrappers
 * - Each wrapper contains SKILL.md
 * - Cross-reference between canonical skills and adapter wrappers
 * - adapters/shared/ contains key modules
 *
 * Run: node --test tests/adapter-wrapper-compat.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = resolve(REPO_ROOT, "skills");
const ADAPTERS_DIR = resolve(REPO_ROOT, "adapters");

const ADAPTER_NAMES = ["claude-code", "codex", "gemini", "openai-compatible"];

/**
 * List skill directories for an adapter (directories under adapters/<name>/skills/).
 */
function listAdapterSkills(adapterName) {
  const skillsPath = resolve(ADAPTERS_DIR, adapterName, "skills");
  if (!existsSync(skillsPath)) return [];
  return readdirSync(skillsPath, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

/**
 * List canonical skill directories (contain SKILL.md, exclude workspace).
 */
function listCanonicalSkills() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.endsWith("-workspace"))
    .filter(e => existsSync(resolve(SKILLS_DIR, e.name, "SKILL.md")))
    .map(e => e.name);
}

// ═══ 1. Adapter skill directory existence ═════════════════════════════

describe("adapter wrapper structure — directory existence", () => {
  for (const adapter of ADAPTER_NAMES) {
    it(`adapters/${adapter}/skills/ directory should exist`, () => {
      const skillsPath = resolve(ADAPTERS_DIR, adapter, "skills");
      assert.ok(existsSync(skillsPath), `${skillsPath} should exist`);
    });
  }
});

// ═══ 2. Adapter skill counts ══════════════════════════════════════════

describe("adapter wrapper structure — skill counts", () => {
  it("claude-code should have >= 25 skills", () => {
    const skills = listAdapterSkills("claude-code");
    assert.ok(
      skills.length >= 25,
      `Expected >= 25 claude-code skills, got ${skills.length}: ${skills.join(", ")}`
    );
  });

  it("codex should have >= 30 skills", () => {
    const skills = listAdapterSkills("codex");
    assert.ok(
      skills.length >= 30,
      `Expected >= 30 codex skills, got ${skills.length}: ${skills.join(", ")}`
    );
  });

  it("gemini should have >= 30 skills", () => {
    const skills = listAdapterSkills("gemini");
    assert.ok(
      skills.length >= 30,
      `Expected >= 30 gemini skills, got ${skills.length}: ${skills.join(", ")}`
    );
  });

  it("openai-compatible should have >= 30 skills", () => {
    const skills = listAdapterSkills("openai-compatible");
    assert.ok(
      skills.length >= 30,
      `Expected >= 30 openai-compatible skills, got ${skills.length}: ${skills.join(", ")}`
    );
  });
});

// ═══ 3. SKILL.md in every adapter skill directory ═════════════════════

describe("adapter wrapper structure — SKILL.md presence", () => {
  for (const adapter of ADAPTER_NAMES) {
    it(`every ${adapter} skill directory should contain SKILL.md`, () => {
      const skills = listAdapterSkills(adapter);
      const missing = [];
      for (const skill of skills) {
        const skillMd = resolve(ADAPTERS_DIR, adapter, "skills", skill, "SKILL.md");
        if (!existsSync(skillMd)) {
          missing.push(skill);
        }
      }
      assert.equal(
        missing.length, 0,
        `${adapter} skills missing SKILL.md: ${missing.join(", ")}`
      );
    });
  }
});

// ═══ 4. Cross-reference: canonical → adapter wrappers ═════════════════

describe("adapter wrapper structure — cross-reference coverage", () => {
  // Some canonical skills are standalone (docx, html-report, report,
  // specialist-review, ui-review) and have no adapter wrappers yet.
  // This baseline documents exactly which ones lack coverage.
  const KNOWN_UNWRAPPED = new Set([
    "docx",
    "html-report",
    "report",
    "specialist-review",
    "ui-review",
  ]);

  it("most canonical skills should have wrappers in at least 2 adapters", () => {
    const canonical = listCanonicalSkills();
    const adapterSkillSets = {};
    for (const adapter of ADAPTER_NAMES) {
      adapterSkillSets[adapter] = new Set(listAdapterSkills(adapter));
    }

    const underCovered = [];
    for (const skill of canonical) {
      if (KNOWN_UNWRAPPED.has(skill)) continue;
      const adapterCount = ADAPTER_NAMES.filter(
        adapter => adapterSkillSets[adapter].has(skill)
      ).length;
      if (adapterCount < 2) {
        const presentIn = ADAPTER_NAMES.filter(
          adapter => adapterSkillSets[adapter].has(skill)
        );
        underCovered.push(`${skill} (in ${adapterCount}: ${presentIn.join(", ") || "none"})`);
      }
    }

    assert.equal(
      underCovered.length, 0,
      `Canonical skills with < 2 adapter wrappers (excluding known unwrapped):\n  ${underCovered.join("\n  ")}`
    );
  });

  it("known unwrapped skills should still be unwrapped (baseline)", () => {
    const adapterSkillSets = {};
    for (const adapter of ADAPTER_NAMES) {
      adapterSkillSets[adapter] = new Set(listAdapterSkills(adapter));
    }

    for (const skill of KNOWN_UNWRAPPED) {
      const adapterCount = ADAPTER_NAMES.filter(
        adapter => adapterSkillSets[adapter].has(skill)
      ).length;
      assert.ok(
        adapterCount < 2,
        `${skill} was expected to be unwrapped but now has ${adapterCount} adapter wrappers — update KNOWN_UNWRAPPED`
      );
    }
  });

  it("known unwrapped count should be exactly 5 (baseline)", () => {
    assert.equal(KNOWN_UNWRAPPED.size, 5, "baseline: 5 known unwrapped canonical skills");
  });
});

// ═══ 5. adapters/shared/ key files ════════════════════════════════════

describe("adapter wrapper structure — shared modules", () => {
  const SHARED_DIR = resolve(ADAPTERS_DIR, "shared");

  it("adapters/shared/ directory should exist", () => {
    assert.ok(existsSync(SHARED_DIR), "adapters/shared/ should exist");
  });

  const requiredFiles = [
    "config-resolver.mjs",
    "repo-resolver.mjs",
    "hook-runner.mjs",
    "cli-adapter.mjs",
  ];

  for (const file of requiredFiles) {
    it(`adapters/shared/${file} should exist`, () => {
      const filePath = resolve(SHARED_DIR, file);
      assert.ok(existsSync(filePath), `${file} should exist in adapters/shared/`);
    });
  }
});
