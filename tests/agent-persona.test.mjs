#!/usr/bin/env node
/**
 * Agent Persona Integration Tests — verifies real persona files load correctly.
 *
 * Tests that platform/adapters/claude-code/agents/*.md are parseable by AgentLoader
 * and contain expected sections. After shared-knowledge refactoring, agents
 * reference agents/knowledge/ for protocol details — tests verify the binding
 * file contains adapter-specific content and points to shared protocol.
 *
 * Run: node --test tests/agent-persona.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolve, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
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
    const frontmatter = persona.content.match(/---[\s\S]*?---/)?.[0] ?? "";
    assert.doesNotMatch(frontmatter, /isolation/);
  });

  it("references shared protocol", () => {
    const persona = loader.load("implementer");
    assert.ok(persona.content.includes("agents/knowledge/implementer-protocol.md"));
  });

  it("shared protocol has Setup and Input sections", () => {
    const protocol = readFileSync(resolve(QUORUM_ROOT, "agents/knowledge/implementer-protocol.md"), "utf8");
    assert.ok(protocol.includes("## Setup"), "Setup section missing in shared protocol");
    assert.ok(protocol.includes("Worktree Environment Check"));
    assert.ok(protocol.includes("## Input (provided by orchestrator)"), "Input section missing in shared protocol");
  });

  it("has Claude Code tool mapping", () => {
    const persona = loader.load("implementer");
    assert.ok(persona.content.includes("CLAUDE_PLUGIN_ROOT"));
    assert.ok(persona.content.includes("tool-runner.mjs"));
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

  it("references shared protocol with Tool-First Principle", () => {
    const persona = loader.load("scout");
    assert.ok(persona.content.includes("agents/knowledge/scout-protocol.md"));
    const protocol = readFileSync(resolve(QUORUM_ROOT, "agents/knowledge/scout-protocol.md"), "utf8");
    assert.ok(protocol.includes("## Tool-First Principle"), "Tool-First Principle missing in shared protocol");
    assert.ok(protocol.includes("deterministic tools before LLM reasoning"));
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
    assert.ok(section.includes("dev server") || section.includes("Verify dev server"));
  });

  it("has Input section", () => {
    const section = loader.getSection("ui-reviewer", "Input");
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

// ═══ 6. Shared knowledge files exist ═════════════════════════════════

describe("shared knowledge integrity", () => {
  const knowledgeDir = resolve(QUORUM_ROOT, "agents", "knowledge");

  it("core protocol files exist", () => {
    assert.ok(existsSync(resolve(knowledgeDir, "implementer-protocol.md")));
    assert.ok(existsSync(resolve(knowledgeDir, "scout-protocol.md")));
    assert.ok(existsSync(resolve(knowledgeDir, "specialist-base.md")));
  });

  it("all 9 domain knowledge files exist", () => {
    const domains = ["perf", "a11y", "compat", "compliance", "concurrency", "docs", "i18n", "infra", "observability"];
    for (const d of domains) {
      assert.ok(existsSync(resolve(knowledgeDir, "domains", `${d}.md`)), `${d}.md missing`);
    }
  });

  it("specialist agents reference specialist-base.md", () => {
    const specialists = [
      "perf-analyst", "a11y-auditor", "compat-reviewer", "compliance-officer",
      "concurrency-verifier", "doc-steward", "i18n-checker", "infra-validator",
      "observability-inspector",
    ];
    for (const name of specialists) {
      const persona = loader.load(name);
      assert.ok(
        persona.content.includes("agents/knowledge/specialist-base.md"),
        `${name} does not reference specialist-base.md`
      );
    }
  });
});
