#!/usr/bin/env node
/**
 * Skill Neutrality Tests — v0.6.0 knowledge-centric model.
 *
 * Enforces:
 * - Core skill manifests are lightweight (no protocol content)
 * - Knowledge protocols are self-contained (no adapter content)
 * - No adapter-specific references leak into knowledge or skills
 *
 * Run: node --test tests/skill-neutrality.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = resolve(REPO_ROOT, "platform", "skills");
const KNOWLEDGE_DIR = resolve(REPO_ROOT, "agents", "knowledge");
const PROTOCOLS_DIR = resolve(KNOWLEDGE_DIR, "protocols");

/**
 * Recursively find all .md files in a directory.
 */
function findMarkdownFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith("-workspace")) continue;
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function listCanonicalSkills() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .filter(e => existsSync(resolve(SKILLS_DIR, e.name, "SKILL.md")))
    .map(e => e.name);
}

// ═══ 1. Skill manifests are lightweight ════════════════════════════════

describe("skill neutrality — manifest size", () => {
  const skills = listCanonicalSkills();

  for (const skill of skills) {
    it(`${skill}/SKILL.md should be a lightweight manifest (<= 40 lines)`, () => {
      const content = readFileSync(resolve(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      const lines = content.split("\n").length;
      assert.ok(lines <= 40, `${skill} has ${lines} lines — should be <= 40 for a manifest`);
    });
  }
});

// ═══ 2. Skill manifests reference knowledge ════════════════════════════

describe("skill neutrality — knowledge references", () => {
  const skills = listCanonicalSkills();

  for (const skill of skills) {
    it(`${skill}/SKILL.md should reference agents/knowledge/`, () => {
      const content = readFileSync(resolve(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      assert.ok(
        content.includes("agents/knowledge/"),
        `${skill}/SKILL.md must reference agents/knowledge/`
      );
    });
  }
});

// ═══ 3. No adapter-specific content in knowledge ══════════════════════

describe("skill neutrality — knowledge base purity", () => {
  const META_FILES = ["README.md"];

  it("no CLAUDE_PLUGIN_ROOT in protocols", () => {
    const files = findMarkdownFiles(PROTOCOLS_DIR);
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      assert.ok(
        !content.includes("${CLAUDE_PLUGIN_ROOT}"),
        `${relative(REPO_ROOT, f)} contains adapter-specific env var`
      );
    }
  });

  it("no GEMINI_EXTENSION_ROOT in protocols", () => {
    const files = findMarkdownFiles(PROTOCOLS_DIR);
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      assert.ok(
        !content.includes("${GEMINI_EXTENSION_ROOT}"),
        `${relative(REPO_ROOT, f)} contains adapter-specific env var`
      );
    }
  });

  it("no adapter-specific tool names in protocols (Read/Write/Edit as tools)", () => {
    // Protocols should use 'quorum tool <name>' not adapter-native tool names.
    // Allow Read/Write/Edit as English words in prose, but flag tool-invocation patterns.
    const files = findMarkdownFiles(PROTOCOLS_DIR);
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      const rel = relative(REPO_ROOT, f);
      // Check for adapter-specific patterns like "| Read file | `Read` |"
      assert.ok(
        !content.includes("| `Read` |") && !content.includes("| `read_file` |"),
        `${rel} contains adapter-specific tool mapping — belongs in tool-names.mjs`
      );
    }
  });
});

// ═══ 4. Core skill count baseline ════════════════════════════════════

describe("skill neutrality — inventory baseline", () => {
  it("should have exactly 11 core skills", () => {
    const skills = listCanonicalSkills();
    assert.equal(skills.length, 11, `Expected 11 core skills, got ${skills.length}: ${skills.join(", ")}`);
  });

  it("platform/skills/ARCHITECTURE.md should exist", () => {
    assert.ok(existsSync(resolve(SKILLS_DIR, "ARCHITECTURE.md")));
  });
});

// ═══ 5. Knowledge completeness ════════════════════════════════════════

describe("skill neutrality — knowledge completeness", () => {
  it("every core skill should have a matching protocol in agents/knowledge/protocols/", () => {
    const skills = listCanonicalSkills();
    const protocols = readdirSync(PROTOCOLS_DIR)
      .filter(f => f.endsWith(".md"))
      .map(f => f.replace(".md", ""));

    for (const skill of skills) {
      const skillContent = readFileSync(resolve(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      // Extract protocol reference from content
      const match = skillContent.match(/protocols\/([a-z-]+)\.md/);
      assert.ok(match, `${skill}/SKILL.md should reference a protocol file`);
      const protocolName = match[1];
      assert.ok(
        protocols.includes(protocolName),
        `Protocol ${protocolName}.md referenced by ${skill} not found in agents/knowledge/protocols/`
      );
    }
  });
});
