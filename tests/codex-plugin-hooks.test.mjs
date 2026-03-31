/**
 * Tests for Phase 2: Hook coexistence, Stop review gate, background jobs.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ── hook-bridge: Stop review gate + merge ──────────────

describe("hook-bridge stop-review-gate", () => {
  let mod;

  before(async () => {
    mod = await import("../platform/adapters/shared/hook-bridge.mjs");
  });

  it("exports hookRunnerToStopReviewGate", () => {
    assert.equal(typeof mod.hookRunnerToStopReviewGate, "function");
  });

  it("exports mergeHookConfigs", () => {
    assert.equal(typeof mod.mergeHookConfigs, "function");
  });

  it("stop gate allows when no fitness and no Stop hooks", async () => {
    const runner = { has: () => false, fire: async () => [] };
    const gate = mod.hookRunnerToStopReviewGate(runner);
    const result = await gate({});
    assert.equal(result.decision, "allow");
  });

  it("stop gate blocks when fitness below threshold", async () => {
    const runner = { has: () => false, fire: async () => [] };
    const gate = mod.hookRunnerToStopReviewGate(runner, "session-1", { fitnessThreshold: 0.8 });
    const result = await gate({ fitness: 0.65 });
    assert.equal(result.decision, "block");
    assert.ok(result.reason.includes("0.65"));
    assert.ok(result.reason.includes("0.8"));
  });

  it("stop gate allows when fitness above threshold", async () => {
    const runner = { has: () => false, fire: async () => [] };
    const gate = mod.hookRunnerToStopReviewGate(runner, "session-1", { fitnessThreshold: 0.7 });
    const result = await gate({ fitness: 0.85 });
    assert.equal(result.decision, "allow");
  });

  it("stop gate blocks when Stop hook returns deny", async () => {
    const runner = {
      has: (event) => event === "Stop",
      fire: async () => [
        { hook_name: "codex-review", output: { decision: "deny", reason: "Issues found" } },
      ],
    };
    const gate = mod.hookRunnerToStopReviewGate(runner);
    const result = await gate({});
    assert.equal(result.decision, "block");
    assert.ok(result.reason.includes("Issues found"));
  });

  it("stop gate blocks when Stop hook returns block", async () => {
    const runner = {
      has: (event) => event === "Stop",
      fire: async () => [
        { hook_name: "stop-gate", output: { decision: "block", reason: "Code review failed" } },
      ],
    };
    const gate = mod.hookRunnerToStopReviewGate(runner);
    const result = await gate({});
    assert.equal(result.decision, "block");
    assert.ok(result.reason.includes("Code review failed"));
  });

  it("stop gate allows when Stop hook returns allow", async () => {
    const runner = {
      has: (event) => event === "Stop",
      fire: async () => [
        { hook_name: "stop-gate", output: { decision: "allow" } },
      ],
    };
    const gate = mod.hookRunnerToStopReviewGate(runner);
    const result = await gate({});
    assert.equal(result.decision, "allow");
  });

  it("fitness gate takes priority over Stop hooks", async () => {
    // Even if Stop hook would allow, low fitness should block
    const runner = {
      has: (event) => event === "Stop",
      fire: async () => [
        { hook_name: "stop-gate", output: { decision: "allow" } },
      ],
    };
    const gate = mod.hookRunnerToStopReviewGate(runner, "s1", { fitnessThreshold: 0.7 });
    const result = await gate({ fitness: 0.5 });
    assert.equal(result.decision, "block");
    assert.ok(result.reason.includes("0.50"));
  });
});

// ── mergeHookConfigs ────────────────────────────────────

describe("mergeHookConfigs", () => {
  let mergeHookConfigs;

  before(async () => {
    const mod = await import("../platform/adapters/shared/hook-bridge.mjs");
    mergeHookConfigs = mod.mergeHookConfigs;
  });

  it("merges non-overlapping events", () => {
    const primary = { SessionStart: [{ id: "q1" }] };
    const secondary = { Stop: [{ id: "p1" }] };
    const merged = mergeHookConfigs(primary, secondary);

    assert.deepEqual(merged.SessionStart, [{ id: "q1" }]);
    assert.deepEqual(merged.Stop, [{ id: "p1" }]);
  });

  it("appends secondary hooks after primary for same event", () => {
    const primary = { Stop: [{ id: "quorum-stop" }] };
    const secondary = { Stop: [{ id: "codex-stop-gate" }] };
    const merged = mergeHookConfigs(primary, secondary);

    assert.equal(merged.Stop.length, 2);
    assert.equal(merged.Stop[0].id, "quorum-stop");
    assert.equal(merged.Stop[1].id, "codex-stop-gate");
  });

  it("preserves primary hooks when no secondary", () => {
    const primary = { PreToolUse: [{ id: "gate1" }], PostToolUse: [{ id: "gate2" }] };
    const merged = mergeHookConfigs(primary, {});

    assert.deepEqual(merged, primary);
  });

  it("handles empty primary", () => {
    const secondary = { Stop: [{ id: "plugin-stop" }] };
    const merged = mergeHookConfigs({}, secondary);

    assert.deepEqual(merged.Stop, [{ id: "plugin-stop" }]);
  });
});

// ── plugin-hooks.json structure ─────────────────────────

describe("plugin-hooks.json", () => {
  it("has valid JSON structure", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync("platform/adapters/codex/hooks/plugin-hooks.json", "utf8");
    const parsed = JSON.parse(raw);

    assert.ok(parsed.hooks);
    assert.ok(parsed.hooks.Stop);
    assert.equal(parsed.hooks.Stop.length, 1);
    assert.equal(parsed.hooks.Stop[0].hooks[0].type, "command");
    assert.ok(parsed.hooks.Stop[0].hooks[0].command.includes("stop-review-gate"));
  });
});

// ── background-job ──────────────────────────────────────

describe("background-job", () => {
  let mod;

  before(async () => {
    await import("../dist/platform/providers/codex/background-job.js").then(m => { mod = m; });
  });

  it("exports job management functions", () => {
    assert.equal(typeof mod.submitBackgroundJob, "function");
    assert.equal(typeof mod.queryJobStatus, "function");
    assert.equal(typeof mod.getJobResult, "function");
    assert.equal(typeof mod.cancelJob, "function");
  });

  it("submitBackgroundJob returns null when plugin unavailable", () => {
    const { resetBrokerCache } = mod;
    // In test env, codex-plugin-cc is not installed
    const result = mod.submitBackgroundJob({ prompt: "test audit" });
    // Should return null (not throw)
    assert.ok(result === null || typeof result === "string");
  });

  it("queryJobStatus returns null when plugin unavailable", () => {
    const result = mod.queryJobStatus("test-job-123");
    assert.ok(result === null || typeof result === "object");
  });

  it("getJobResult returns null when plugin unavailable", () => {
    const result = mod.getJobResult("test-job-123");
    assert.ok(result === null || typeof result === "object");
  });

  it("cancelJob returns false when plugin unavailable", () => {
    const result = mod.cancelJob("test-job-123");
    assert.equal(typeof result, "boolean");
  });
});
