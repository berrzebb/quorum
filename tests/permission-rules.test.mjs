#!/usr/bin/env node
/**
 * Permission Rules Engine Tests — PERM-1
 *
 * Run: node --test tests/permission-rules.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RulesEngine,
  parseContentPattern,
  matchContentPattern,
  matchSimpleGlob,
  extractContent,
} from "../dist/platform/bus/permission-rules.js";

// ═══ 1. Simple Glob Matching ═══════════════════════════

describe("matchSimpleGlob", () => {
  it("exact match", () => {
    assert.ok(matchSimpleGlob("Bash", "Bash"));
    assert.ok(!matchSimpleGlob("Bash", "Read"));
  });

  it("trailing wildcard (prefix match)", () => {
    assert.ok(matchSimpleGlob("mcp__quorum*", "mcp__quorum__code_map"));
    assert.ok(matchSimpleGlob("mcp__quorum*", "mcp__quorum__blast_radius"));
    assert.ok(!matchSimpleGlob("mcp__quorum*", "mcp__chrome__navigate"));
  });

  it("leading wildcard (suffix match)", () => {
    assert.ok(matchSimpleGlob("*_scan", "perf_scan"));
    assert.ok(matchSimpleGlob("*_scan", "a11y_scan"));
    assert.ok(!matchSimpleGlob("*_scan", "code_map"));
  });

  it("both wildcards (contains)", () => {
    assert.ok(matchSimpleGlob("*quorum*", "mcp__quorum__blast_radius"));
    assert.ok(!matchSimpleGlob("*quorum*", "mcp__chrome__navigate"));
  });

});

// ═══ 2. Content Pattern Parsing ═════════════════════════

describe("parseContentPattern", () => {
  it("prefix pattern", () => {
    const p = parseContentPattern("prefix:rm");
    assert.equal(p.type, "prefix");
    assert.equal(p.value, "rm");
  });

  it("contains pattern", () => {
    const p = parseContentPattern("contains:delete");
    assert.equal(p.type, "contains");
    assert.equal(p.value, "delete");
  });

  it("regex pattern", () => {
    const p = parseContentPattern("regex:^rm\\s+-rf");
    assert.equal(p.type, "regex");
    assert.ok(p.compiledRegex instanceof RegExp);
  });

  it("invalid regex pattern", () => {
    const p = parseContentPattern("regex:[invalid");
    assert.equal(p.type, "regex");
    assert.equal(p.compiledRegex, null);
  });

  it("path pattern", () => {
    const p = parseContentPattern("path:*.env");
    assert.equal(p.type, "path");
    assert.equal(p.value, "*.env");
  });

  it("exact match (no prefix)", () => {
    const p = parseContentPattern("exactvalue");
    assert.equal(p.type, "exact");
    assert.equal(p.value, "exactvalue");
  });

});

// ═══ 3. Content Pattern Matching ════════════════════════

describe("matchContentPattern", () => {
  it("prefix match", () => {
    const p = parseContentPattern("prefix:rm");
    assert.ok(matchContentPattern(p, "rm -rf /tmp"));
    assert.ok(!matchContentPattern(p, "ls -la"));
  });

  it("contains match", () => {
    const p = parseContentPattern("contains:delete");
    assert.ok(matchContentPattern(p, "please delete this file"));
    assert.ok(!matchContentPattern(p, "SELECT * FROM users"));
  });

  it("regex match", () => {
    const p = parseContentPattern("regex:^rm\\s+-rf");
    assert.ok(matchContentPattern(p, "rm -rf /tmp"));
    assert.ok(!matchContentPattern(p, "echo rm -rf"));
  });

  it("path match", () => {
    const p = parseContentPattern("path:*.env");
    assert.ok(matchContentPattern(p, ".env"));
    assert.ok(matchContentPattern(p, "secrets.env"));
    assert.ok(!matchContentPattern(p, "config.json"));
  });

  it("exact match", () => {
    const p = parseContentPattern("exactly-this");
    assert.ok(matchContentPattern(p, "exactly-this"));
    assert.ok(!matchContentPattern(p, "not-this"));
  });
});

// ═══ 4. Content Extraction ══════════════════════════════

describe("extractContent", () => {
  it("Bash → command", () => {
    assert.equal(extractContent("Bash", { command: "rm -rf /tmp" }), "rm -rf /tmp");
  });

  it("Write → file_path", () => {
    assert.equal(extractContent("Write", { file_path: "/etc/passwd" }), "/etc/passwd");
  });

  it("Edit → file_path", () => {
    assert.equal(extractContent("Edit", { file_path: "src/secret.ts" }), "src/secret.ts");
  });

  it("MCP tool → JSON stringify", () => {
    const result = extractContent("mcp__quorum__blast_radius", { changed_files: ["a.ts"] });
    assert.ok(result.includes("changed_files"));
  });

  it("no input → empty string", () => {
    assert.equal(extractContent("Bash"), "");
  });
});

// ═══ 5. RulesEngine ═════════════════════════════════════

describe("RulesEngine", () => {
  it("deny rule matches exact tool", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", content: "prefix:rm", behavior: "deny" });

    const result = engine.evaluate({ tool: "Bash", input: { command: "rm -rf /" } });
    assert.ok(result);
    assert.equal(result.behavior, "deny");
  });

  it("deny rule does not match different tool", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", content: "prefix:rm", behavior: "deny" });

    const result = engine.evaluate({ tool: "Read", input: { file_path: "rm.txt" } });
    assert.equal(result, null);
  });

  it("deny rule without content matches all invocations of tool", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", behavior: "deny" });

    const result = engine.evaluate({ tool: "Bash", input: { command: "ls" } });
    assert.ok(result);
    assert.equal(result.behavior, "deny");
  });

  it("allow rule matches", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Read", behavior: "allow" });

    const result = engine.evaluate({ tool: "Read", input: { file_path: "src/main.ts" } });
    assert.ok(result);
    assert.equal(result.behavior, "allow");
  });

  it("deny beats allow (same tool)", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", behavior: "allow" });
    engine.addRule({ tool: "Bash", content: "prefix:rm", behavior: "deny" });

    const result = engine.evaluate({ tool: "Bash", input: { command: "rm -rf /" } });
    assert.ok(result);
    assert.equal(result.behavior, "deny");
  });

  it("ask beats allow, loses to deny", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Write", behavior: "allow" });
    engine.addRule({ tool: "Write", content: "path:*.env", behavior: "ask" });
    engine.addRule({ tool: "Write", content: "path:/etc/*", behavior: "deny" });

    // .env → ask (not allow)
    const envResult = engine.evaluate({ tool: "Write", input: { file_path: "secret.env" } });
    assert.ok(envResult);
    assert.equal(envResult.behavior, "ask");

    // /etc/ → deny (beats ask and allow)
    const etcResult = engine.evaluate({ tool: "Write", input: { file_path: "/etc/passwd" } });
    assert.ok(etcResult);
    assert.equal(etcResult.behavior, "deny");
  });

  it("glob pattern matches MCP tools", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "mcp__quorum*", behavior: "allow" });

    assert.ok(engine.evaluate({ tool: "mcp__quorum__code_map" }));
    assert.equal(engine.evaluate({ tool: "mcp__chrome__navigate" }), null);
  });

  it("empty rule set returns null", () => {
    const engine = new RulesEngine();
    assert.equal(engine.evaluate({ tool: "Bash", input: { command: "ls" } }), null);
  });

  it("evaluateBehavior filters by behavior", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", behavior: "deny", content: "prefix:rm" });
    engine.addRule({ tool: "Bash", behavior: "allow" });

    // Only check deny rules
    const denyResult = engine.evaluateBehavior(
      { tool: "Bash", input: { command: "ls" } },
      "deny",
    );
    assert.equal(denyResult, null); // ls doesn't match prefix:rm

    const allowResult = engine.evaluateBehavior(
      { tool: "Bash", input: { command: "ls" } },
      "allow",
    );
    assert.ok(allowResult);
    assert.equal(allowResult.behavior, "allow");
  });

  it("reason includes rule and source", () => {
    const engine = new RulesEngine();
    engine.addRule({ tool: "Bash", behavior: "deny", source: "policy" });

    const result = engine.evaluate({ tool: "Bash", input: { command: "anything" } });
    assert.ok(result);
    assert.equal(result.reason.type, "rule");
    assert.equal(result.reason.source, "policy");
  });

  it("performance: 100 rules evaluate < 5ms", () => {
    const engine = new RulesEngine();
    for (let i = 0; i < 100; i++) {
      engine.addRule({ tool: `tool_${i}`, behavior: "allow" });
    }
    engine.addRule({ tool: "target", behavior: "deny" });

    const start = performance.now();
    for (let j = 0; j < 1000; j++) {
      engine.evaluate({ tool: "target" });
    }
    const elapsed = performance.now() - start;
    // 1000 evaluations should be well under 5ms per call
    assert.ok(elapsed < 5000, `1000 evals took ${elapsed}ms (limit: 5000ms)`);
  });
});
