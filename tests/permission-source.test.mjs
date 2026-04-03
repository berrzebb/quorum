#!/usr/bin/env node
/**
 * Permission Source Tracker Tests — PERM-2
 *
 * Run: node --test tests/permission-source.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  RuleSourceTracker,
  tierPriority,
  getSettingSourceDisplayName,
  loadRulesFromConfig,
  loadAllTierRules,
} from "../dist/platform/bus/permission-source.js";

// ═══ 1. Tier Priority ═══════════════════════════════════

describe("tierPriority", () => {
  it("project > user > session > cli", () => {
    assert.ok(tierPriority("project") < tierPriority("user"));
    assert.ok(tierPriority("user") < tierPriority("session"));
    assert.ok(tierPriority("session") < tierPriority("cli"));
  });
});

// ═══ 2. Display Names ═══════════════════════════════════

describe("getSettingSourceDisplayName", () => {
  it("returns non-empty string for known sources", () => {
    for (const src of ["policy", "project", "user", "session", "cli"]) {
      const name = getSettingSourceDisplayName(src);
      assert.ok(typeof name === "string" && name.length > 0, `${src} should have a display name`);
    }
  });
});

// ═══ 3. loadRulesFromConfig ═════════════════════════════

describe("loadRulesFromConfig", () => {
  const tmpDir = join(tmpdir(), `quorum-perm-test-${Date.now()}`);

  // Setup
  it("setup temp dir", () => {
    mkdirSync(tmpDir, { recursive: true });
  });

  it("loads valid rules file", () => {
    const path = join(tmpDir, "valid.json");
    writeFileSync(path, JSON.stringify({
      rules: [
        { tool: "Bash", content: "prefix:rm", behavior: "deny" },
        { tool: "Read", behavior: "allow" },
      ],
    }));

    const rules = loadRulesFromConfig(path, "project");
    assert.equal(rules.length, 2);
    assert.equal(rules[0].tool, "Bash");
    assert.equal(rules[0].behavior, "deny");
    assert.equal(rules[0].source, "project");
    assert.equal(rules[1].behavior, "allow");
  });

  it("returns empty for nonexistent file", () => {
    assert.deepEqual(loadRulesFromConfig("/nonexistent/path.json", "user"), []);
  });

  it("returns empty for invalid JSON", () => {
    const path = join(tmpDir, "invalid.json");
    writeFileSync(path, "not json {{{");
    assert.deepEqual(loadRulesFromConfig(path, "user"), []);
  });

  it("skips rules with missing tool field", () => {
    const path = join(tmpDir, "no-tool.json");
    writeFileSync(path, JSON.stringify({
      rules: [
        { behavior: "deny" },
        { tool: "Bash", behavior: "deny" },
      ],
    }));
    const rules = loadRulesFromConfig(path, "project");
    assert.equal(rules.length, 1);
  });

  it("skips rules with invalid behavior", () => {
    const path = join(tmpDir, "bad-behavior.json");
    writeFileSync(path, JSON.stringify({
      rules: [
        { tool: "Bash", behavior: "explode" },
        { tool: "Read", behavior: "allow" },
      ],
    }));
    const rules = loadRulesFromConfig(path, "project");
    assert.equal(rules.length, 1);
  });

  it("returns empty for empty path", () => {
    assert.deepEqual(loadRulesFromConfig("", "user"), []);
  });

  // Cleanup
  it("cleanup temp dir", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ═══ 4. RuleSourceTracker ═══════════════════════════════

describe("RuleSourceTracker", () => {
  it("tracks and returns rule source", () => {
    const tracker = new RuleSourceTracker();
    const rule = { tool: "Bash", behavior: /** @type {const} */ ("deny") };
    tracker.trackRule(rule, "policy");
    assert.equal(tracker.getSource(rule), "policy");
  });

  it("resolves conflict — policy beats project", () => {
    const tracker = new RuleSourceTracker();
    const policyRule = { tool: "Bash", behavior: /** @type {const} */ ("deny"), source: /** @type {const} */ ("policy") };
    const projectRule = { tool: "Bash", behavior: /** @type {const} */ ("allow"), source: /** @type {const} */ ("project") };
    tracker.trackRule(policyRule, "policy");
    tracker.trackRule(projectRule, "project");

    const winner = tracker.resolveConflict(policyRule, projectRule);
    assert.equal(winner.source, "policy");
    assert.equal(winner.behavior, "deny");
  });

  it("resolves conflict — project beats user", () => {
    const tracker = new RuleSourceTracker();
    const projectRule = { tool: "Write", behavior: /** @type {const} */ ("ask"), source: /** @type {const} */ ("project") };
    const userRule = { tool: "Write", behavior: /** @type {const} */ ("allow"), source: /** @type {const} */ ("user") };

    const winner = tracker.resolveConflict(projectRule, userRule);
    assert.equal(winner.source, "project");
  });

  it("clear resets tracked sources", () => {
    const tracker = new RuleSourceTracker();
    const rule = { tool: "Bash", behavior: /** @type {const} */ ("deny") };
    tracker.trackRule(rule, "policy");
    tracker.clear();
    // source is still on the rule object itself, but tracker map is cleared
    assert.equal(tracker.getSource(rule), "policy"); // Falls back to rule.source
  });
});

// ═══ 5. loadAllTierRules ════════════════════════════════

describe("loadAllTierRules", () => {
  const tmpDir = join(tmpdir(), `quorum-tier-test-${Date.now()}`);

  it("setup temp dirs", () => {
    mkdirSync(tmpDir, { recursive: true });
  });

  it("loads from multiple tiers in priority order", () => {
    const policyPath = join(tmpDir, "policy.json");
    const projectPath = join(tmpDir, "project.json");
    const userPath = join(tmpDir, "user.json");

    writeFileSync(policyPath, JSON.stringify({
      rules: [{ tool: "Bash", content: "prefix:rm", behavior: "deny" }],
    }));
    writeFileSync(projectPath, JSON.stringify({
      rules: [{ tool: "Read", behavior: "allow" }],
    }));
    writeFileSync(userPath, JSON.stringify({
      rules: [{ tool: "Write", behavior: "ask" }],
    }));

    const { rules, tracker } = loadAllTierRules(undefined, {
      policy: policyPath,
      project: projectPath,
      user: userPath,
    });

    assert.equal(rules.length, 3);
    // Policy rules come first
    assert.equal(rules[0].source, "policy");
    assert.equal(rules[1].source, "project");
    assert.equal(rules[2].source, "user");
  });

  it("handles missing tier files gracefully", () => {
    const { rules } = loadAllTierRules(undefined, {
      policy: "/nonexistent/policy.json",
      project: "/nonexistent/project.json",
      user: "/nonexistent/user.json",
    });
    assert.equal(rules.length, 0);
  });

  it("cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
