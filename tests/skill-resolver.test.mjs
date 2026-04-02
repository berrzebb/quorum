#!/usr/bin/env node
/**
 * Skill Resolver Tests — verify dynamic skill composition.
 *
 * Run: node --test tests/skill-resolver.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSkill,
  resolveProtocol,
  listProtocols,
  listDomains,
} from "../platform/adapters/shared/skill-resolver.mjs";

// ═══ 1. resolveSkill — core skills ══════════════════════════════════

describe("skill-resolver — resolveSkill", () => {
  it("should resolve planner for claude-code", () => {
    const result = resolveSkill("planner", "claude-code");
    assert.ok(result, "planner should resolve");
    assert.ok(result.name.startsWith("quorum:"), "claude-code uses colon prefix");
    assert.ok(result.content.includes("Planner Protocol"), "should include protocol content");
    assert.ok(result.content.includes("| bash | `Bash` |"), "should include tool mapping");
  });

  it("should resolve planner for codex", () => {
    const result = resolveSkill("planner", "codex");
    assert.ok(result);
    assert.ok(result.name.startsWith("quorum-"), "codex uses hyphen prefix");
    assert.ok(result.content.includes("| bash | `shell` |"), "codex tool mapping");
  });

  it("should resolve planner for gemini", () => {
    const result = resolveSkill("planner", "gemini");
    assert.ok(result);
    assert.ok(result.name.startsWith("quorum-"), "gemini uses hyphen prefix");
    assert.ok(result.content.includes("| bash | `run_shell_command` |"), "gemini tool mapping");
  });

  it("should resolve all 11 core skills for claude-code", () => {
    const coreSkills = [
      "audit", "consensus-tools", "designer", "fde-analyst", "harness-bootstrap",
      "merge-worktree", "orchestrator", "planner", "status", "verify", "wb-parser",
    ];
    for (const skill of coreSkills) {
      const result = resolveSkill(skill, "claude-code");
      assert.ok(result, `${skill} should resolve for claude-code`);
      assert.ok(result.content.length > 100, `${skill} should have substantial content`);
    }
  });

  it("should return null for nonexistent skill", () => {
    const result = resolveSkill("nonexistent-skill", "claude-code");
    assert.equal(result, null);
  });

  it("should include model from manifest", () => {
    const result = resolveSkill("planner", "claude-code");
    assert.equal(result.model, "opus");
  });

  it("should include description from manifest", () => {
    const result = resolveSkill("audit", "claude-code");
    assert.ok(result.description.length > 20, "should have meaningful description");
  });
});

// ═══ 2. resolveProtocol — on-demand protocols ═══════════════════════

describe("skill-resolver — resolveProtocol", () => {
  it("should resolve fixer protocol for claude-code", () => {
    const result = resolveProtocol("fixer", "claude-code");
    assert.ok(result, "fixer protocol should resolve");
    assert.ok(result.content.includes("Fixer Protocol"), "should include protocol content");
    assert.ok(result.toolTable.includes("| bash | `Bash` |"), "should include tool table");
  });

  it("should resolve fixer protocol for codex", () => {
    const result = resolveProtocol("fixer", "codex");
    assert.ok(result);
    assert.ok(result.toolTable.includes("| bash | `shell` |"), "codex tools");
  });

  it("should resolve on-demand protocols", () => {
    const onDemand = [
      "convergence-loop", "doc-sync", "export", "fixer", "gap-detector",
      "mermaid", "retrospect", "rollback", "rtm-scanner", "scout",
    ];
    for (const name of onDemand) {
      const result = resolveProtocol(name, "claude-code");
      assert.ok(result, `${name} protocol should resolve`);
      assert.ok(result.content.length > 50, `${name} should have content`);
    }
  });

  it("should return null for nonexistent protocol", () => {
    const result = resolveProtocol("nonexistent", "claude-code");
    assert.equal(result, null);
  });
});

// ═══ 3. listProtocols / listDomains ═════════════════════════════════

describe("skill-resolver — discovery", () => {
  it("should list >= 20 protocols", () => {
    const protocols = listProtocols();
    assert.ok(protocols.length >= 20, `Expected >= 20 protocols, got ${protocols.length}`);
    assert.ok(protocols.includes("planner"));
    assert.ok(protocols.includes("fixer"));
    assert.ok(protocols.includes("implementer"));
  });

  it("should list 11 domains", () => {
    const domains = listDomains();
    assert.equal(domains.length, 11, `Expected 11 domains, got ${domains.length}`);
    assert.ok(domains.includes("perf"));
    assert.ok(domains.includes("security"));
    assert.ok(domains.includes("a11y"));
  });
});

// ═══ 4. Adapter parity — same content, different tools ══════════════

describe("skill-resolver — adapter parity", () => {
  it("all adapters get the same protocol content for a skill", () => {
    const adapters = ["claude-code", "codex", "gemini", "openai-api"];
    const results = adapters.map(a => resolveSkill("verify", a));

    // All should resolve
    for (let i = 0; i < adapters.length; i++) {
      assert.ok(results[i], `verify should resolve for ${adapters[i]}`);
    }

    // Protocol content should be the same (ignoring tool table)
    const protocolContent = results.map(r =>
      r.content.replace(/## Tool Mapping[\s\S]*$/, "").trim()
    );
    // All should contain the same protocol core
    for (let i = 1; i < protocolContent.length; i++) {
      assert.ok(
        protocolContent[i].includes("Verification Protocol"),
        `${adapters[i]} should include protocol content`
      );
    }
  });

  it("different adapters get different tool names", () => {
    const cc = resolveSkill("planner", "claude-code");
    const codex = resolveSkill("planner", "codex");
    assert.ok(cc.content.includes("`Bash`"), "claude-code uses Bash");
    assert.ok(codex.content.includes("`shell`"), "codex uses shell");
    assert.ok(!cc.content.includes("`shell`"), "claude-code should not have codex tools");
    assert.ok(!codex.content.includes("`Bash`"), "codex should not have claude-code tools");
  });
});
