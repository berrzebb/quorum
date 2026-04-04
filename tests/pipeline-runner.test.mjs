/**
 * Tests: Pipeline Runner (HIDE WB-1 + WB-2)
 * runPipeline + buildAgenda + buildPipelineDirective
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { runPipeline, buildAgenda, buildPipelineDirective, getStages } from "../platform/adapters/shared/pipeline-runner.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), "pipe-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Test config — uses fake provider to avoid spawning real claude. */
const TEST_CONFIG = { pipeline: { provider: "__test__" } };

/** Mock bridge. */
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
    execution: { ...overrides.execution },
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
    const result = await runPipeline("인증 시스템 구현", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    assert.equal(result.success, true);
    assert.equal(result.stages.length, 6);
    assert.equal(result.failedAt, undefined);
  });

  it("stages execute in correct order", async () => {
    const order = [];
    const bridge = createMockBridge();
    await runPipeline("test", TEST_CONFIG, bridge, {
      repoRoot: tmpDir,
      onStageChange: (stage, status) => {
        if (status === "running") order.push(stage);
      },
    });
    assert.deepEqual(order, ["plan", "design", "implement", "verify", "qa", "finalize"]);
  });

  it("plan stage uses parliament when available", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("인증", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    const planOutput = result.stages[0].output;
    assert.equal(planOutput.source, "parliament");
    assert.ok(planOutput.cps);
    assert.equal(planOutput.converged, true);
  });

  it("plan stage falls back to template when parliament fails", async () => {
    const bridge = createMockBridge({
      parliament: { runParliamentSession: async () => { throw new Error("no auditors"); } },
    });
    const result = await runPipeline("인증", { ...TEST_CONFIG, gates: { gateProfile: "strict" } }, bridge, { repoRoot: tmpDir });
    const planOutput = result.stages[0].output;
    assert.equal(planOutput.source, "template");
    assert.equal(planOutput.gateProfile, "strict");
  });

  it("plan stage falls back to template when parliament missing", async () => {
    const bridge = { parliament: {}, event: { emitEvent: () => {} } };
    const result = await runPipeline("test", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    assert.equal(result.stages[0].output.source, "template");
  });

  it("design stage generates work-breakdown or template", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("인증", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    const designOutput = result.stages[1].output;
    assert.ok(designOutput.trackName);
    // WB should be generated (provider fallback creates template)
    assert.ok(designOutput.wbPath || designOutput.source === "failed");
  });

  it("implement stage spawns provider or falls back to brief", async () => {
    const bridge = createMockBridge();
    // Use a non-existent provider to trigger fallback
    const result = await runPipeline("인증", {
      domains: { active: ["security"] },
      pipeline: { provider: "nonexistent-provider-test" },
    }, bridge, { repoRoot: tmpDir });
    const implOutput = result.stages[2].output;
    // Should fall back to brief when provider unavailable
    assert.equal(implOutput.fallback, "brief");
    const briefPath = resolve(tmpDir, ".claude", "quorum", "pipeline", "implement-brief.md");
    assert.ok(existsSync(briefPath));
    const content = readFileSync(briefPath, "utf8");
    assert.ok(content.includes("security"));
  });

  it("verify stage runs commands and reports results", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("test", {
      ...TEST_CONFIG, verify: { commands: ["echo hello"] },
    }, bridge, { repoRoot: tmpDir });
    const verifyOutput = result.stages[3].output;
    assert.equal(verifyOutput.allPassed, true);
    assert.equal(verifyOutput.results.length, 1);
    assert.equal(verifyOutput.results[0].passed, true);
  });

  it("verify stage captures command failures", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("test", {
      ...TEST_CONFIG, verify: { commands: ["node -e \"process.exit(1)\""] },
    }, bridge, { repoRoot: tmpDir });
    const verifyOutput = result.stages[3].output;
    assert.equal(verifyOutput.allPassed, false);
    assert.equal(verifyOutput.results[0].passed, false);
  });

  it("verify stage passes when no commands configured (fitness gate still runs)", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("test", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    const verifyOutput = result.stages[3].output;
    assert.equal(verifyOutput.allPassed, true);
    assert.deepEqual(verifyOutput.results, []);
  });

  it("qa stage produces fix guidance on failures", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("test", {
      ...TEST_CONFIG, verify: { commands: ["node -e \"process.exit(1)\""] },
    }, bridge, { repoRoot: tmpDir });
    const qaOutput = result.stages[4].output;
    assert.equal(qaOutput.passed, false);
    assert.ok(qaOutput.totalRounds >= 1);
    assert.ok(qaOutput.guidance.length > 0);
  });

  it("qa stage reports passed when verify succeeds", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("test", {
      ...TEST_CONFIG, verify: { commands: ["echo ok"] },
    }, bridge, { repoRoot: tmpDir });
    const qaOutput = result.stages[4].output;
    assert.equal(qaOutput.passed, true);
    // Audit should be attempted (skipped in test since mock auditors don't have audit())
    assert.ok(qaOutput.auditVerdict);
  });

  it("qa stage includes codex audit round when auditors available", async () => {
    const bridge = createMockBridge({
      parliament: {
        ...createMockBridge().parliament,
        createConsensusAuditors: async () => ({
          judge: {
            async audit() { return { verdict: "approved", codes: [], summary: "LGTM", raw: "{}", duration: 10 }; },
            async available() { return true; },
          },
        }),
      },
    });
    const result = await runPipeline("test", {
      ...TEST_CONFIG, verify: { commands: ["echo ok"] },
    }, bridge, { repoRoot: tmpDir });
    const qaOutput = result.stages[4].output;
    assert.equal(qaOutput.auditVerdict, "approved");
    const auditRound = qaOutput.rounds.find(r => r.phase === "codex-audit");
    assert.ok(auditRound);
    assert.equal(auditRound.verdict, "approved");
  });

  it("qa stage returns rejected when auditor rejects", async () => {
    const bridge = createMockBridge({
      parliament: {
        ...createMockBridge().parliament,
        createConsensusAuditors: async () => ({
          judge: {
            async audit() { return { verdict: "changes_requested", codes: ["security-issue"], summary: "SQL injection risk", raw: "{}", duration: 10 }; },
            async available() { return true; },
          },
        }),
      },
    });
    const result = await runPipeline("test", {
      ...TEST_CONFIG, verify: { commands: ["echo ok"] },
    }, bridge, { repoRoot: tmpDir });
    const qaOutput = result.stages[4].output;
    assert.equal(qaOutput.passed, false);
    assert.equal(qaOutput.auditVerdict, "changes_requested");
  });

  it("finalize writes completion state", async () => {
    const bridge = createMockBridge();
    await runPipeline("인증", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    const statePath = resolve(tmpDir, ".claude", "quorum", "pipeline", "state.json");
    assert.ok(existsSync(statePath));
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.status, "complete");
    assert.equal(state.agenda, "인증");
  });

  it("finalize emits pipeline.complete event", async () => {
    const bridge = createMockBridge();
    await runPipeline("인증", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    const completeEvent = bridge._events.find(e => e.type === "pipeline.complete");
    assert.ok(completeEvent);
    assert.equal(completeEvent.payload.agenda, "인증");
  });

  it("emits pipeline.stage.complete events", async () => {
    const bridge = createMockBridge();
    await runPipeline("test", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    const stageEvents = bridge._events.filter(e => e.type === "pipeline.stage.complete");
    assert.equal(stageEvents.length, 6);
  });

  it("records stage duration", async () => {
    const bridge = createMockBridge();
    const result = await runPipeline("test", TEST_CONFIG, bridge, { repoRoot: tmpDir });
    for (const s of result.stages) {
      assert.ok(typeof s.duration === "number");
      assert.ok(s.duration >= 0);
    }
    assert.ok(typeof result.totalDuration === "number");
  });
});

describe("buildPipelineDirective", () => {
  it("includes agenda in directive", () => {
    const directive = buildPipelineDirective("인증 시스템 구현", {});
    assert.ok(directive.includes("인증 시스템 구현"));
    assert.ok(directive.includes("auto-pipeline"));
  });

  it("includes verify commands", () => {
    const directive = buildPipelineDirective("구현", {
      verify: { commands: ["npm test", "npx tsc --noEmit"] },
    });
    assert.ok(directive.includes("`npm test`"));
    assert.ok(directive.includes("`npx tsc --noEmit`"));
  });

  it("includes gate profile and domains", () => {
    const directive = buildPipelineDirective("구현", {
      gates: { gateProfile: "strict" },
      domains: { active: ["security", "i18n"] },
    });
    assert.ok(directive.includes("strict"));
    assert.ok(directive.includes("security"));
    assert.ok(directive.includes("i18n"));
  });

  it("maps parliament rounds to team size", () => {
    assert.ok(buildPipelineDirective("x", { parliament: { maxRounds: 1 } }).includes("solo"));
    assert.ok(buildPipelineDirective("x", { parliament: { maxRounds: 3 } }).includes("small"));
    assert.ok(buildPipelineDirective("x", { parliament: { maxRounds: 5 } }).includes("large"));
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

  it("handles empty profile", () => {
    const intent = { agenda: "프로젝트", gateProfile: "balanced", teamSize: "solo", ci: null, activeDomains: [] };
    const emptyProfile = { languages: [], frameworks: [], activeDomains: [] };
    assert.ok(buildAgenda(intent, emptyProfile).includes("프로젝트"));
  });
});

describe("getStages", () => {
  it("returns 6 stages in order", () => {
    assert.deepEqual([...getStages()], ["plan", "design", "implement", "verify", "qa", "finalize"]);
  });
});
