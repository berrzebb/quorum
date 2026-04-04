/**
 * Tests: Pipeline Runner (HIDE WB-1 + WB-2)
 * runPipeline + buildAgenda — mock bridge, no LLM calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPipeline, buildAgenda, getStages } from "../platform/adapters/shared/pipeline-runner.mjs";

/** Mock bridge that succeeds for all operations. */
function createMockBridge(overrides = {}) {
  const events = [];
  return {
    parliament: {
      runParliamentSession: async ({ agenda }) => ({
        cps: { context: "test", problem: agenda[0], solution: "test solution" },
        converged: true,
      }),
      ...overrides.parliament,
    },
    execution: {
      planExecution: ({ cps }) => ({ trackId: "test-track", wbCount: 5 }),
      ...overrides.execution,
    },
    gate: {
      computeFitness: () => ({ total: 0.85 }),
      ...overrides.gate,
    },
    event: {
      emitEvent: (type, source, payload) => events.push({ type, source, payload }),
    },
    _events: events,
  };
}

describe("runPipeline", () => {
  it("completes all 6 stages successfully", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("인증 시스템 구현", {}, bridge);
    assert.equal(result.success, true);
    assert.equal(result.stages.length, 6);
    assert.equal(result.failedAt, undefined);
    for (const s of result.stages) {
      assert.equal(s.status, "success");
    }
  });

  it("stages execute in correct order", async () => {
    const order = [];
    const bridge = createMockBridge();
    await runPipeline("test", {}, bridge, {
      onStageChange: (stage, status) => {
        if (status === "running") order.push(stage);
      },
    });
    assert.deepEqual(order, ["plan", "design", "implement", "verify", "qa", "finalize"]);
  });

  it("stops on failure and preserves completed stages", async () => {
    const bridge = createMockBridge({
      execution: {
        planExecution: () => { throw new Error("planner crashed"); },
      },
    });
    const result = await runPipeline("test", {}, bridge);
    assert.equal(result.success, false);
    assert.equal(result.failedAt, "design");
    // plan succeeded, design failed
    assert.equal(result.stages[0].status, "success"); // plan
    assert.equal(result.stages[1].status, "failed");  // design
    assert.equal(result.stages.length, 2); // stopped at design
  });

  it("emits pipeline events to EventStore", async () => {
    const bridge = createMockBridge();
    await runPipeline("test", {}, bridge);
    const stageEvents = bridge._events.filter(e => e.type.startsWith("pipeline.stage."));
    assert.ok(stageEvents.length >= 6); // at least 6 complete events
  });

  it("records stage duration", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("test", {}, bridge);
    for (const s of result.stages) {
      assert.ok(typeof s.duration === "number");
      assert.ok(s.duration >= 0);
    }
    assert.ok(typeof result.totalDuration === "number");
  });

  it("handles missing bridge functions gracefully (skip)", async () => {
    const bridge = {
      parliament: {},
      execution: {},
      gate: {},
      event: { emitEvent: () => {} },
    };
    const result = await runPipeline("test", {}, bridge);
    assert.equal(result.success, true);
    // Stages should complete with "skipped" outputs
    assert.ok(result.stages[0].output.skipped); // plan skipped
  });

  it("plan stage produces CPS that feeds into design", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("인증", {}, bridge);
    const planOutput = result.stages[0].output;
    assert.ok(planOutput.cps);
    assert.equal(planOutput.converged, true);
  });
});

describe("buildAgenda (WB-2)", () => {
  const baseProfile = {
    languages: ["typescript"], packageManager: "npm", frameworks: ["express"],
    ci: "github-actions", testFramework: "vitest", activeDomains: ["security"],
    estimatedSize: "medium",
  };

  it("builds agenda with language + framework + goal", () => {
    const intent = { agenda: "인증 시스템 구현", gateProfile: "strict", teamSize: "solo", ci: null, activeDomains: ["security"] };
    const agenda = buildAgenda(intent, baseProfile);
    assert.ok(agenda.includes("typescript"));
    assert.ok(agenda.includes("express"));
    assert.ok(agenda.includes("인증 시스템 구현"));
  });

  it("includes priority hint for strict", () => {
    const intent = { agenda: "구현", gateProfile: "strict", teamSize: "solo", ci: null, activeDomains: [] };
    assert.ok(buildAgenda(intent, baseProfile).includes("보안 최우선"));
  });

  it("includes priority hint for fast", () => {
    const intent = { agenda: "구현", gateProfile: "fast", teamSize: "solo", ci: null, activeDomains: [] };
    assert.ok(buildAgenda(intent, baseProfile).includes("빠른 구현"));
  });

  it("no hint for balanced", () => {
    const intent = { agenda: "구현", gateProfile: "balanced", teamSize: "solo", ci: null, activeDomains: [] };
    const agenda = buildAgenda(intent, baseProfile);
    assert.ok(!agenda.includes("보안 최우선"));
    assert.ok(!agenda.includes("빠른 구현"));
  });

  it("includes domain hints", () => {
    const intent = { agenda: "구현", gateProfile: "balanced", teamSize: "solo", ci: null, activeDomains: ["security", "i18n"] };
    const agenda = buildAgenda(intent, baseProfile);
    assert.ok(agenda.includes("security"));
    assert.ok(agenda.includes("i18n"));
  });

  it("handles empty profile", () => {
    const intent = { agenda: "프로젝트", gateProfile: "balanced", teamSize: "solo", ci: null, activeDomains: [] };
    const emptyProfile = { languages: [], frameworks: [], activeDomains: [] };
    const agenda = buildAgenda(intent, emptyProfile);
    assert.ok(agenda.includes("프로젝트"));
  });
});

describe("getStages", () => {
  it("returns 6 stages in order", () => {
    assert.deepEqual([...getStages()], ["plan", "design", "implement", "verify", "qa", "finalize"]);
  });
});
