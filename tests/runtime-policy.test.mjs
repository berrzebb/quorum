#!/usr/bin/env node
/**
 * SDK-16: Runtime Selection Policy Tests
 *
 * Tests that config validation, runtime policy, and production boundaries
 * are explicit contracts rather than ad-hoc env vars.
 *
 * Run: node --test tests/runtime-policy.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  defaultRuntimeConfig,
  resolveExecutionMode,
  mergeRuntimeConfig,
  isSessionRuntimeEnabled,
  validateRuntimeConfig,
  describeRuntimePolicy,
} = await import("../dist/platform/providers/runtime-selector.js");

// ═══ 1. Config Validation ═══════════════════════════════════════════════

describe("validateRuntimeConfig", () => {
  it("returns no warnings for default config", () => {
    const config = defaultRuntimeConfig();
    const warnings = validateRuntimeConfig(config);
    assert.deepStrictEqual(warnings, []);
  });

  it("warns on invalid codex mode", () => {
    const config = mergeRuntimeConfig({ codex: { mode: "agent_sdk" } });
    const warnings = validateRuntimeConfig(config);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("codex.mode"));
    assert.ok(warnings[0].includes("agent_sdk"));
  });

  it("warns on invalid claude mode", () => {
    const config = mergeRuntimeConfig({ claude: { mode: "invalid_mode" } });
    const warnings = validateRuntimeConfig(config);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("claude.mode"));
  });
});

// ═══ 2. Runtime Policy Description ══════════════════════════════════════

describe("describeRuntimePolicy", () => {
  it("returns policies for both providers", () => {
    const policies = describeRuntimePolicy();
    assert.equal(policies.length, 2);
    assert.equal(policies[0].provider, "codex");
    assert.equal(policies[1].provider, "claude");
  });

  it("codex policy has cli_exec only", () => {
    const policies = describeRuntimePolicy();
    const codex = policies.find(p => p.provider === "codex");
    assert.ok(codex);
    assert.deepStrictEqual(codex.validModes, ["cli_exec"]);
    assert.equal(codex.defaultMode, "cli_exec");
  });

  it("claude policy has correct valid modes", () => {
    const policies = describeRuntimePolicy();
    const claude = policies.find(p => p.provider === "claude");
    assert.ok(claude);
    assert.deepStrictEqual(claude.validModes, ["cli_exec", "agent_sdk"]);
    assert.equal(claude.defaultMode, "cli_exec");
  });

  it("each policy has production note", () => {
    const policies = describeRuntimePolicy();
    for (const policy of policies) {
      assert.ok(policy.productionNote, `${policy.provider} should have productionNote`);
    }
  });
});

// ═══ 3. Fallback Guarantee ══════════════════════════════════════════════

describe("resolveExecutionMode — fallback guarantee", () => {
  it("cli_exec never falls back", () => {
    const result = resolveExecutionMode("codex", "cli_exec", {});
    assert.equal(result.mode, "cli_exec");
    assert.equal(result.fallback, false);
  });

  it("agent_sdk falls back when SDK unavailable", () => {
    const result = resolveExecutionMode("claude", "agent_sdk", { claudeSdkAvailable: false });
    assert.equal(result.mode, "cli_exec");
    assert.equal(result.fallback, true);
    assert.ok(result.reason);
  });

  it("cross-provider mode falls back gracefully", () => {
    const result = resolveExecutionMode("codex", "agent_sdk", {});
    assert.equal(result.mode, "cli_exec");
    assert.equal(result.fallback, true);
  });
});

// ═══ 4. Config Merge ════════════════════════════════════════════════════

describe("mergeRuntimeConfig", () => {
  it("returns defaults for undefined input", () => {
    const config = mergeRuntimeConfig(undefined);
    assert.equal(config.codex.mode, "cli_exec");
    assert.equal(config.claude.mode, "cli_exec");
  });

  it("merges partial codex config", () => {
    const config = mergeRuntimeConfig({ codex: { mode: "cli_exec", binary: "/opt/codex" } });
    assert.equal(config.codex.mode, "cli_exec");
    assert.equal(config.codex.binary, "/opt/codex");
    assert.equal(config.claude.mode, "cli_exec");
  });

  it("isSessionRuntimeEnabled detects non-default modes", () => {
    const defaults = defaultRuntimeConfig();
    assert.equal(isSessionRuntimeEnabled(defaults), false);

    const upgraded = mergeRuntimeConfig({ claude: { mode: "agent_sdk" } });
    assert.equal(isSessionRuntimeEnabled(upgraded), true);
  });
});
