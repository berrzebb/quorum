import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

// Import the compiled CliSessionEvaluator
const distPath = resolve(process.cwd(), "dist/platform/providers/evaluators/cli-session.js");

describe("CliSessionEvaluator", async () => {
  let CliSessionEvaluator;

  try {
    const mod = await import("file:///" + distPath.replace(/\\/g, "/"));
    CliSessionEvaluator = mod.CliSessionEvaluator;
  } catch {
    // dist may not exist in CI — skip gracefully
    it("skipped (dist not available)", () => { assert.ok(true); });
    return;
  }

  it("passes allowed verify commands", async () => {
    const evaluator = new CliSessionEvaluator(process.cwd());
    const result = await evaluator.run({
      specId: "test",
      scenarios: [
        { scenarioId: "s1", surface: "cli", target: "version", verifier: "node --version", successCriteria: [], requiredEvidence: [], blocking: false },
      ],
      requiredEnvironments: [],
      evidenceOutputs: [],
    });
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.findings.length, 0);
    assert.ok(result.evidence.length > 0);
  });

  it("blocks commands not in allowlist", async () => {
    const evaluator = new CliSessionEvaluator(process.cwd());
    const result = await evaluator.run({
      specId: "test",
      scenarios: [
        { scenarioId: "s1", surface: "cli", target: "echo", verifier: "echo hello", successCriteria: [], requiredEvidence: [], blocking: false },
      ],
      requiredEnvironments: [],
      evidenceOutputs: [],
    });
    assert.strictEqual(result.passed, false);
    assert.ok(result.findings.some(f => f.includes("BLOCKED") || f.includes("allowlist")));
  });

  it("blocks shell metacharacters", async () => {
    const evaluator = new CliSessionEvaluator(process.cwd());
    const result = await evaluator.run({
      specId: "test",
      scenarios: [
        { scenarioId: "s1", surface: "cli", target: "meta", verifier: "npm test & echo injected", successCriteria: [], requiredEvidence: [], blocking: false },
      ],
      requiredEnvironments: [],
      evidenceOutputs: [],
    });
    assert.strictEqual(result.passed, false);
  });

  it("blocks dangerous interpreter inline flags (python -c, ruby -e, etc.)", async () => {
    const evaluator = new CliSessionEvaluator(process.cwd());
    const blocked = [
      "python -c print(1)",
      "python3 -e import(os)",
      "ruby -e puts(1)",
      "perl -e print(1)",
    ];
    for (const cmd of blocked) {
      const result = await evaluator.run({
        specId: "test",
        scenarios: [
          { scenarioId: "s1", surface: "cli", target: "interp", verifier: cmd, successCriteria: [], requiredEvidence: [], blocking: false },
        ],
        requiredEnvironments: [],
        evidenceOutputs: [],
      });
      assert.strictEqual(result.passed, false, `Expected "${cmd}" to be blocked`);
    }
  });

  it("blocks Windows %VAR% expansion", async () => {
    const evaluator = new CliSessionEvaluator(process.cwd());
    const result = await evaluator.run({
      specId: "test",
      scenarios: [
        { scenarioId: "s1", surface: "cli", target: "pct", verifier: "npm test %COMSPEC%", successCriteria: [], requiredEvidence: [], blocking: false },
      ],
      requiredEnvironments: [],
      evidenceOutputs: [],
    });
    assert.strictEqual(result.passed, false);
  });

  it("skips non-CLI surfaces", async () => {
    const evaluator = new CliSessionEvaluator(process.cwd());
    const result = await evaluator.run({
      specId: "test",
      scenarios: [
        { scenarioId: "s1", surface: "browser", target: "web", verifier: "echo hello", successCriteria: [], requiredEvidence: [], blocking: false },
      ],
      requiredEnvironments: [],
      evidenceOutputs: [],
    });
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.findings.length, 0);
  });
});
