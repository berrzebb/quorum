#!/usr/bin/env node
/**
 * Agent Persona Integration Tests — verifies real persona files load correctly.
 *
 * Tests that adapters/claude-code/agents/*.md are parseable by AgentLoader
 * and contain expected sections.
 *
 * Run: node --test tests/agent-persona.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { AgentLoader } = await import("../dist/providers/agent-loader.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUORUM_ROOT = resolve(__dirname, "..");

// ═══ Loader pointing to real adapter agents ═══════════════════════════

const loader = new AgentLoader({
  quorumRoot: QUORUM_ROOT,
  adapter: "claude-code",
});

// ═══ 1. Discovery ═════════════════════════════════════════════════════

describe("persona discovery", () => {
  it("lists all 3 agent personas", () => {
    const agents = loader.listAvailable();
    assert.ok(agents.includes("implementer"), "implementer not found");
    assert.ok(agents.includes("scout"), "scout not found");
    assert.ok(agents.includes("ui-reviewer"), "ui-reviewer not found");
  });

  it("resolves paths to adapter agents directory", () => {
    const path = loader.resolvedPath("implementer");
    assert.ok(path);
    assert.ok(path.includes("adapters"));
    assert.ok(path.includes("claude-code"));
    assert.ok(path.endsWith("implementer.md"));
  });
});

// ═══ 2. Implementer ═══════════════════════════════════════════════════

describe("implementer persona", () => {
  it("loads successfully", () => {
    const persona = loader.load("implementer");
    assert.ok(persona);
    assert.equal(persona.name, "implementer");
  });

  it("contains frontmatter with model (no isolation — orchestrator creates worktree)", () => {
    const persona = loader.load("implementer");
    assert.ok(persona.content.includes("model: claude-sonnet-4-6"));
    // implementer does NOT have isolation: worktree in frontmatter.
    // The orchestrator creates the worktree; implementer runs inside it.
    // Having isolation: worktree would cause double worktree creation.
    const frontmatter = persona.content.match(/---[\s\S]*?---/)?.[0] ?? "";
    assert.doesNotMatch(frontmatter, /isolation/);
  });

  it("has Setup section", () => {
    const section = loader.getSection("implementer", "Setup");
    assert.ok(section, "Setup section missing");
    assert.ok(section.includes("Worktree Environment Check"));
  });

  it("has Input section", () => {
    const section = loader.getSection("implementer", "Input (provided by orchestrator)");
    assert.ok(section, "Input section missing");
  });

  it("references consensus skills", () => {
    const persona = loader.load("implementer");
    assert.ok(persona.content.includes("quorum:verify"));
    assert.ok(persona.content.includes("quorum:guide"));
  });
});

// ═══ 3. Scout ═════════════════════════════════════════════════════════

describe("scout persona", () => {
  it("loads successfully", () => {
    const persona = loader.load("scout");
    assert.ok(persona);
    assert.equal(persona.name, "scout");
  });

  it("is read-only (no Write/Edit in tools)", () => {
    const persona = loader.load("scout");
    assert.ok(persona.content.includes("tools: Read, Grep, Glob, Bash"));
    assert.ok(!persona.content.includes("allowed-tools:") ||
              !persona.content.match(/allowed-tools:.*Write/));
  });

  it("has Tool Invocation section", () => {
    const section = loader.getSection("scout", "Tool Invocation");
    assert.ok(section, "Tool Invocation section missing");
    assert.ok(section.includes("tool-runner.mjs"));
  });

  it("has Tool-First Principle section", () => {
    const section = loader.getSection("scout", "Tool-First Principle");
    assert.ok(section, "Tool-First Principle section missing");
    assert.ok(section.includes("deterministic tools before LLM reasoning"));
  });

  it("uses Opus model", () => {
    const persona = loader.load("scout");
    assert.ok(persona.content.includes("model: claude-opus-4-6"));
  });
});

// ═══ 4. UI Reviewer ══════════════════════════════════════════════════

describe("ui-reviewer persona", () => {
  it("loads successfully", () => {
    const persona = loader.load("ui-reviewer");
    assert.ok(persona);
    assert.equal(persona.name, "ui-reviewer");
  });

  it("has browser tools in allowed-tools", () => {
    const persona = loader.load("ui-reviewer");
    assert.ok(persona.content.includes("mcp__claude-in-chrome__navigate"));
    assert.ok(persona.content.includes("mcp__claude-in-chrome__read_page"));
  });

  it("has Setup section with dev server check", () => {
    const section = loader.getSection("ui-reviewer", "Setup");
    assert.ok(section, "Setup section missing");
    assert.ok(section.includes("Verify Dev Server") || section.includes("dev server"));
  });

  it("has Input section", () => {
    const section = loader.getSection("ui-reviewer", "Input (provided by orchestrator or user)");
    assert.ok(section, "Input section missing");
  });
});

// ═══ 5. Section extraction consistency ═══════════════════════════════

describe("section extraction across all personas", () => {
  it("every persona has at least 2 sections", () => {
    for (const name of ["implementer", "scout", "ui-reviewer"]) {
      const persona = loader.load(name);
      assert.ok(persona.sections.size >= 2, `${name} has only ${persona.sections.size} section(s)`);
    }
  });

  it("no section content is empty", () => {
    for (const name of ["implementer", "scout", "ui-reviewer"]) {
      const persona = loader.load(name);
      for (const [heading, content] of persona.sections) {
        assert.ok(content.trim().length > 0, `${name} section "${heading}" is empty`);
      }
    }
  });
});
