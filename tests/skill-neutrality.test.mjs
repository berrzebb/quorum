#!/usr/bin/env node
/**
 * Skill Neutrality Tests — frozen contract for PLT track.
 *
 * Enforces zero-tolerance: adapter-specific references MUST NOT appear
 * in canonical skills (platform/skills/**). These tests prevent regression after
 * PLT-11A (env vars), PLT-11B (script invocations), and PLT-11C (freeze).
 *
 * Run: node --test tests/skill-neutrality.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = resolve(REPO_ROOT, "platform", "skills");

/**
 * Recursively find all .md files in a directory, excluding workspace dirs.
 */
function findMarkdownFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip workspace directories
      if (entry.name.endsWith("-workspace")) continue;
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Count occurrences of a string pattern in all .md files under platform/skills/ (excluding workspace).
 * Optionally exclude specific files (by relative path from SKILLS_DIR, forward-slash normalized).
 */
function countPatternInSkills(pattern, excludeFiles = []) {
  const files = findMarkdownFiles(SKILLS_DIR);
  let total = 0;
  const fileHits = [];
  for (const filePath of files) {
    const rel = relative(SKILLS_DIR, filePath).replace(/\\/g, "/");
    if (excludeFiles.some(ex => rel === ex)) continue;
    const content = readFileSync(filePath, "utf8");
    const matches = content.split(pattern).length - 1;
    if (matches > 0) {
      total += matches;
      fileHits.push({ file: filePath, count: matches });
    }
  }
  return { total, fileHits };
}

/**
 * Count occurrences of a regex pattern in all .md files under platform/skills/ (excluding workspace).
 * Optionally exclude specific files (by relative path from SKILLS_DIR).
 */
function countRegexInSkills(regex, excludeFiles = []) {
  const files = findMarkdownFiles(SKILLS_DIR);
  let total = 0;
  const fileHits = [];
  for (const filePath of files) {
    const rel = relative(SKILLS_DIR, filePath).replace(/\\/g, "/");
    if (excludeFiles.some(ex => rel === ex)) continue;
    const content = readFileSync(filePath, "utf8");
    const matches = content.match(regex);
    if (matches && matches.length > 0) {
      total += matches.length;
      fileHits.push({ file: filePath, count: matches.length });
    }
  }
  return { total, fileHits };
}

/**
 * List canonical skill directories (contain SKILL.md, exclude workspace).
 */
function listCanonicalSkills() {
  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith("-workspace")) continue;
    const skillMd = resolve(SKILLS_DIR, entry.name, "SKILL.md");
    if (existsSync(skillMd)) {
      skills.push(entry.name);
    }
  }
  return skills;
}

/** Format file hits for error messages. */
function fmtHits(fileHits) {
  return fileHits
    .map(h => `${relative(SKILLS_DIR, h.file).replace(/\\/g, "/")}:${h.count}`)
    .join(", ");
}

/**
 * Meta files that document the neutrality contract itself.
 * These legitimately mention prohibited patterns as examples.
 */
const META_FILES = ["ARCHITECTURE.md"];

// ═══ 1. Adapter-specific env vars — zero tolerance ══════════════════════

describe("skill neutrality — adapter-specific env vars", () => {
  it("CLAUDE_PLUGIN_ROOT must be 0", () => {
    const { total, fileHits } = countPatternInSkills("${CLAUDE_PLUGIN_ROOT}", META_FILES);
    assert.equal(total, 0,
      `Expected 0 CLAUDE_PLUGIN_ROOT, got ${total}. Files: ${fmtHits(fileHits)}`);
  });

  it("GEMINI_EXTENSION_ROOT must be 0", () => {
    const { total, fileHits } = countPatternInSkills("${GEMINI_EXTENSION_ROOT}", META_FILES);
    assert.equal(total, 0,
      `Expected 0 GEMINI_EXTENSION_ROOT, got ${total}. Files: ${fmtHits(fileHits)}`);
  });

  it("CODEX_PLUGIN_ROOT must be 0", () => {
    const { total, fileHits } = countPatternInSkills("${CODEX_PLUGIN_ROOT}", META_FILES);
    assert.equal(total, 0,
      `Expected 0 CODEX_PLUGIN_ROOT, got ${total}. Files: ${fmtHits(fileHits)}`);
  });

  it("no adapter-specific env var patterns (PLUGIN_ROOT, EXTENSION_ROOT variants)", () => {
    // Catch any future adapter-specific env vars we haven't thought of yet.
    // Excludes ${ADAPTER_ROOT} and ${QUORUM_*} which are legitimate.
    const regex = /\$\{(?!ADAPTER_ROOT|QUORUM_)[A-Z_]*(?:PLUGIN_ROOT|EXTENSION_ROOT)[A-Z_]*\}/g;
    const { total, fileHits } = countRegexInSkills(regex, META_FILES);
    assert.equal(total, 0,
      `Expected 0 adapter-specific env var patterns, got ${total}. Files: ${fmtHits(fileHits)}`);
  });
});

// ═══ 2. Direct script invocations — zero tolerance ══════════════════════

describe("skill neutrality — direct script invocations", () => {
  it("tool-runner.mjs references must be 0", () => {
    const { total, fileHits } = countPatternInSkills("tool-runner.mjs", META_FILES);
    assert.equal(total, 0,
      `Expected 0 tool-runner.mjs references, got ${total}. Files: ${fmtHits(fileHits)}`);
  });

  it("node ${ADAPTER_ROOT} invocations must be 0", () => {
    const regex = /node\s+\$\{ADAPTER_ROOT\}/g;
    const { total, fileHits } = countRegexInSkills(regex, META_FILES);
    assert.equal(total, 0,
      `Expected 0 'node \${ADAPTER_ROOT}' invocations, got ${total}. Files: ${fmtHits(fileHits)}`);
  });
});

// ═══ 3. Adapter directory references — meta-only ════════════════════════

describe("skill neutrality — adapter directory references", () => {
  it("adapters/{name}/ references must only appear in meta files", () => {
    // ARCHITECTURE.md, doc-sync references, and skill-authoring SKILL.md are meta/documentation
    // files that legitimately reference adapter paths for instructional purposes.
    // All other canonical skill files must not reference adapter directories.
    const allowedFiles = [
      "ARCHITECTURE.md",
      "doc-sync/references/l1-public-docs.md",
      "skill-authoring/SKILL.md",
    ];
    const regex = /adapters\/(?:claude-code|gemini|codex)\//g;
    const { total, fileHits } = countRegexInSkills(regex, allowedFiles);
    assert.equal(total, 0,
      `Expected 0 adapter directory references outside meta files, got ${total}. ` +
      `Files: ${fmtHits(fileHits)}`);
  });
});

// ═══ 4. Canonical skill inventory ═══════════════════════════════════════

describe("skill neutrality — canonical skill inventory", () => {
  it("should list canonical skill directories with SKILL.md", () => {
    const skills = listCanonicalSkills();
    assert.ok(skills.length > 0, "should find at least one canonical skill");
    // Current count is 36 (excludes workspace dirs).
    // Allow +-5 for flexibility as skills are added/removed.
    assert.ok(
      skills.length >= 30,
      `Expected >= 30 canonical skills, got ${skills.length}: ${skills.join(", ")}`
    );
    assert.ok(
      skills.length <= 45,
      `Expected <= 45 canonical skills, got ${skills.length}`
    );
  });

  it("platform/skills/ARCHITECTURE.md should exist", () => {
    const archPath = resolve(SKILLS_DIR, "ARCHITECTURE.md");
    assert.ok(existsSync(archPath), "platform/skills/ARCHITECTURE.md should exist");
  });
});

// ═══ 5. Workspace directories are excluded ══════════════════════════════

describe("skill neutrality — workspace exclusion", () => {
  it("workspace directories should not be counted as canonical skills", () => {
    const allDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    const workspaceDirs = allDirs.filter(name => name.endsWith("-workspace"));
    const canonicalSkills = listCanonicalSkills();

    for (const ws of workspaceDirs) {
      assert.ok(
        !canonicalSkills.includes(ws),
        `Workspace dir '${ws}' should not appear in canonical skills`
      );
    }
  });
});
