#!/usr/bin/env node
/**
 * Agent Loader Tests — 4-tier resolution, section extraction, LRU cache.
 *
 * Run: node --test tests/agent-loader.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { AgentLoader } = await import("../dist/providers/agent-loader.js");

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "loader-test-"));
});

after(() => {
  try {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* Windows file locks */ }
});

function writeAgent(dir, name, content) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), content);
}

// ═══ 1. Basic loading ═════════════════════════════════════════════════

describe("AgentLoader basic", () => {
  it("loads agent from adapter directory", () => {
    const adapterDir = join(tmpDir, "adapters", "claude-code", "agents");
    writeAgent(adapterDir, "implementer", "# Implementer\n\n## Role\nHeadless worker\n\n## Rules\n- Test everything\n");

    const loader = new AgentLoader({
      quorumRoot: tmpDir,
      adapter: "claude-code",
    });

    const persona = loader.load("implementer");
    assert.ok(persona);
    assert.equal(persona.name, "implementer");
    assert.ok(persona.content.includes("Headless worker"));
  });

  it("returns null for nonexistent agent", () => {
    const loader = new AgentLoader({ quorumRoot: tmpDir, adapter: "claude-code" });
    assert.equal(loader.load("nonexistent"), null);
  });
});

// ═══ 2. Section extraction ════════════════════════════════════════════

describe("section extraction", () => {
  it("extracts ## sections from markdown", () => {
    const dir = join(tmpDir, "section-test", "agents");
    writeAgent(dir, "scout", [
      "# Scout Agent",
      "",
      "## Role",
      "Read-only RTM generator",
      "",
      "## Tools",
      "- code_map",
      "- dependency_graph",
      "",
      "## Constraints",
      "Never modify files",
    ].join("\n"));

    const loader = new AgentLoader({ quorumRoot: join(tmpDir, "section-test") });
    const persona = loader.load("scout");

    assert.ok(persona);
    assert.equal(persona.sections.get("Role"), "Read-only RTM generator");
    assert.ok(persona.sections.get("Tools").includes("code_map"));
    assert.equal(persona.sections.get("Constraints"), "Never modify files");
  });

  it("getSection() returns specific section", () => {
    const dir = join(tmpDir, "getsection", "agents");
    writeAgent(dir, "reviewer", "## Focus\nSecurity\n\n## Style\nThorough\n");

    const loader = new AgentLoader({ quorumRoot: join(tmpDir, "getsection") });
    assert.equal(loader.getSection("reviewer", "Focus"), "Security");
    assert.equal(loader.getSection("reviewer", "Style"), "Thorough");
    assert.equal(loader.getSection("reviewer", "Missing"), null);
  });
});

// ═══ 3. Tier resolution ═══════════════════════════════════════════════

describe("4-tier resolution", () => {
  it("project-scoped overrides adapter default", () => {
    const adapterDir = join(tmpDir, "tier-test", "adapters", "claude-code", "agents");
    const projectDir = join(tmpDir, "tier-test", "project", ".quorum", "agents");

    writeAgent(adapterDir, "planner", "## Role\nAdapter default planner\n");
    writeAgent(projectDir, "planner", "## Role\nProject custom planner\n");

    // Override cwd BEFORE constructing loader (search paths resolve at construction)
    const origCwd = process.cwd;
    process.cwd = () => join(tmpDir, "tier-test", "project");
    try {
      const loader = new AgentLoader({
        quorumRoot: join(tmpDir, "tier-test"),
        adapter: "claude-code",
      });

      const persona = loader.load("planner");
      assert.ok(persona);
      assert.ok(persona.content.includes("Project custom planner"));
    } finally {
      process.cwd = origCwd;
    }
  });

  it("env var overrides all other tiers", () => {
    const envDir = join(tmpDir, "env-agents");
    const adapterDir = join(tmpDir, "env-test", "adapters", "claude-code", "agents");

    writeAgent(envDir, "judge", "## Role\nEnv override judge\n");
    writeAgent(adapterDir, "judge", "## Role\nAdapter default judge\n");

    process.env.QUORUM_AGENTS_DIR = envDir;
    try {
      const loader = new AgentLoader({
        quorumRoot: join(tmpDir, "env-test"),
        adapter: "claude-code",
      });

      const persona = loader.load("judge");
      assert.ok(persona);
      assert.ok(persona.content.includes("Env override judge"));
    } finally {
      delete process.env.QUORUM_AGENTS_DIR;
    }
  });
});

// ═══ 4. List available ════════════════════════════════════════════════

describe("listAvailable", () => {
  it("lists agents from all tiers without duplicates", () => {
    const root = join(tmpDir, "list-test");
    const adapterDir = join(root, "adapters", "claude-code", "agents");
    const builtinDir = join(root, "agents");

    writeAgent(adapterDir, "implementer", "## Role\nimpl\n");
    writeAgent(adapterDir, "scout", "## Role\nscout\n");
    writeAgent(builtinDir, "scout", "## Role\nbuilt-in scout\n");
    writeAgent(builtinDir, "reviewer", "## Role\nreviewer\n");

    const loader = new AgentLoader({ quorumRoot: root, adapter: "claude-code" });
    const names = loader.listAvailable();

    assert.ok(names.includes("implementer"));
    assert.ok(names.includes("scout"));
    assert.ok(names.includes("reviewer"));
    // No duplicates
    assert.equal(names.filter((n) => n === "scout").length, 1);
  });
});

// ═══ 5. LRU cache ═════════════════════════════════════════════════════

describe("LRU cache", () => {
  it("caches loaded personas", () => {
    const dir = join(tmpDir, "cache-test", "agents");
    writeAgent(dir, "cached-agent", "## Role\nCached\n");

    const loader = new AgentLoader({ quorumRoot: join(tmpDir, "cache-test"), cacheSize: 3 });

    const first = loader.load("cached-agent");
    const second = loader.load("cached-agent");
    assert.equal(first, second); // Same reference
  });

  it("evicts least recently used when cache is full", () => {
    const dir = join(tmpDir, "evict-test", "agents");
    writeAgent(dir, "a", "## Role\nA\n");
    writeAgent(dir, "b", "## Role\nB\n");
    writeAgent(dir, "c", "## Role\nC\n");
    writeAgent(dir, "d", "## Role\nD\n");

    const loader = new AgentLoader({ quorumRoot: join(tmpDir, "evict-test"), cacheSize: 3 });

    loader.load("a");
    loader.load("b");
    loader.load("c");
    loader.load("d"); // Evicts "a"

    // "a" should be reloaded (different reference)
    const reloaded = loader.load("a");
    assert.ok(reloaded);
    assert.equal(reloaded.name, "a");
  });

  it("clearCache() empties the cache", () => {
    const dir = join(tmpDir, "clear-test", "agents");
    writeAgent(dir, "temp", "## Role\nTemp\n");

    const loader = new AgentLoader({ quorumRoot: join(tmpDir, "clear-test") });
    loader.load("temp");
    loader.clearCache();

    // After clear, should reload from disk
    const reloaded = loader.load("temp");
    assert.ok(reloaded);
  });
});
