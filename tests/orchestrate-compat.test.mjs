/**
 * Orchestrate command surface tests.
 * Freezes public API surface + pure-function behavior of the canonical
 * `platform/cli` and `platform/orchestrate` modules.
 * Complements orchestrate-integration.test.mjs and wave-gates.test.mjs.
 * Run: node --test tests/orchestrate-compat.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const shared = await import("../dist/platform/cli/commands/orchestrate/shared.js");
const runner = await import("../dist/platform/cli/commands/orchestrate/runner.js");
const planner = await import("../dist/platform/cli/commands/orchestrate/planner.js");
const { DIST, parseWorkBreakdown, reviewPlan, computeWaves, verifyDesignDiagrams } = shared;
const { buildDepContextFromManifests, detectFixLoopStagnation } = runner;

const TMP = resolve(tmpdir(), `quorum-compat-${Date.now()}`);
before(() => mkdirSync(TMP, { recursive: true }));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch (err) { console.warn("orchestrate-compat cleanup failed:", err?.message ?? err); } });

function writeTempWB(name, content) {
  const dir = resolve(TMP, "docs", "plan", name);
  mkdirSync(dir, { recursive: true });
  const p = resolve(dir, "work-breakdown.md");
  writeFileSync(p, content, "utf8");
  return p;
}

// ═══ 1. Export surface — all public names exist ══════════════════════

describe("shared.ts exports", () => {
  for (const n of ["DIST","loadBridge","findTracks","resolveTrack","trackRef",
    "parseWorkBreakdown","reviewPlan","computeWaves","verifyDesignDiagrams"])
    it(`exports ${n}`, () => assert.ok(n in shared));
  it("DIST is string", () => assert.equal(typeof DIST, "string"));
});

describe("planner.ts exports", () => {
  for (const n of ["interactivePlanner","autoGenerateWBs","autoFixDesignDiagrams"])
    it(`exports ${n}`, () => { assert.ok(n in planner); assert.equal(typeof planner[n], "function"); });
});

describe("runner.ts exports", () => {
  for (const n of ["runImplementationLoop","runPreflightCheck","collectFitnessSignals",
    "runFitnessGate","scanLines","scanForStubs","runProjectTests","detectRegressions",
    "buildDepContextFromManifests","waveCommit","verifyPhaseCompletion","updateRTM",
    "getChangedFiles","detectFileScopeViolations","scanBlueprintViolations",
    "detectOrphanFiles","scanForPerfAntiPatterns","auditNewDependencies",
    "checkTestFileCreation","checkWBConstraints","detectFixLoopStagnation"])
    it(`exports ${n}`, () => assert.ok(n in runner));
});

// ═══ 2. parseWorkBreakdown — full field extraction ═══════════════════

describe("parseWorkBreakdown field snapshot", () => {
  it("extracts all fields from flat items", () => {
    const p = writeTempWB("s-flat", [
      "## SN-1: Setup Project (Size: XS)",
      "- **First touch files**: `src/core.ts`, `src/util.ts`",
      "- **Action**: Create config", "- **Verify**: `npm run build`",
      "- **Constraints**: No new deps", "- **Done**: Build passes",
      "", "## SN-2: Core (Size: S)",
      "- **Prerequisite**: SN-1", "- **First touch files**: `src/app.ts`",
      "- **Action**: Implement logic",
      "- **Context budget**:", "  - Read: `src/types.ts`, `src/config.ts`",
      "  - Skip: `node_modules/`",
      "- **Verify**: `npm test`", "- **Done**: Tests pass",
    ].join("\n"));
    const items = parseWorkBreakdown(p);
    assert.equal(items.length, 2);
    const s1 = items[0];
    assert.equal(s1.id, "SN-1"); assert.equal(s1.size, "XS");
    assert.equal(s1.action, "Create config"); assert.equal(s1.verify, "npm run build");
    assert.equal(s1.done, "Build passes"); assert.equal(s1.constraints, "No new deps");
    assert.equal(s1.dependsOn, undefined); assert.equal(s1.isParent, undefined);
    assert.ok(s1.targetFiles.includes("src/core.ts"));
    const s2 = items[1];
    assert.deepEqual(s2.dependsOn, ["SN-1"]);
    assert.ok(s2.contextBudget); assert.ok(s2.contextBudget.read.includes("src/types.ts"));
  });

  it("hierarchy: Phase parents assign parentId", () => {
    const p = writeTempWB("s-hier", [
      "## Phase 0: Prerequisites", "", "## HI-1: Scaffolding (Size: XS)",
      "- **Action**: init", "- **Verify**: `ls`", "- **Done**: ok",
      "", "## Phase 1: Core", "", "## HI-2: Feature (Size: M)",
      "- **Prerequisite**: HI-1", "- **First touch files**: `src/a.ts`",
      "- **Action**: build", "- **Verify**: `npm test`", "- **Done**: pass",
    ].join("\n"));
    const items = parseWorkBreakdown(p);
    assert.equal(items.length, 4);
    assert.equal(items.filter(i => i.isParent).length, 2);
    assert.equal(items.filter(i => !i.isParent)[0].parentId, "Phase-0");
    assert.equal(items.filter(i => !i.isParent)[1].parentId, "Phase-1");
  });

  it("returns [] for non-existent file", () => {
    assert.deepEqual(parseWorkBreakdown("/nonexistent/path.md"), []);
  });
});

// ═══ 3. reviewPlan — structural validation ═══════════════════════════

describe("reviewPlan structural validation", () => {
  const ok = { id: "W-1", targetFiles: ["a.ts"], action: "do", verify: "npm test", size: "S", constraints: "x" };
  it("passes for well-formed item", () => { const r = reviewPlan([ok]); assert.equal(r.passed, true); });
  it("fails: empty", () => assert.ok(reviewPlan([]).errors.some(e => e.includes("No work items"))));
  it("fails: no Action", () => assert.ok(reviewPlan([{ id: "W-1", targetFiles: ["a"], verify: "t" }]).errors.some(e => e.includes("Action"))));
  it("fails: no Verify", () => assert.ok(reviewPlan([{ id: "W-1", targetFiles: ["a"], action: "d" }]).errors.some(e => e.includes("Verify"))));
  it("fails: >10 files", () => assert.ok(reviewPlan([{ id: "W-1", targetFiles: ["a","b","c","d","e","f","g","h","i","j","k"], action: "d", verify: "t" }]).errors.length > 0));

  it("parent skips Action/Verify; error if no children", () => {
    const withChild = reviewPlan([{ id: "P", targetFiles: [], isParent: true }, { ...ok, parentId: "P" }]);
    assert.equal(withChild.passed, true);
    assert.ok(reviewPlan([{ id: "P", targetFiles: [], isParent: true }]).errors.some(e => e.includes("no children")));
  });

  it("warns: no files, no Size, no Constraints", () => {
    const r = reviewPlan([{ id: "W-1", targetFiles: [], action: "d", verify: "npm test" }]);
    assert.ok(r.warnings.some(w => w.includes("No target files")));
    assert.ok(r.warnings.some(w => w.includes("No Size")));
    assert.ok(r.warnings.some(w => w.includes("No Constraints")));
  });

  it("GATE-N: valid=0, invalid=5", () => {
    const base = [{ id: "P", targetFiles: [], isParent: true }, { ...ok, parentId: "P" }];
    assert.ok(!reviewPlan([...base, { ...ok, id: "W-2", dependsOn: ["GATE-0"] }]).errors.some(e => e.includes("GATE")));
    assert.ok(reviewPlan([...base, { ...ok, id: "W-2", dependsOn: ["GATE-5"] }]).errors.some(e => e.includes("GATE-5")));
  });
});

// ═══ 4. computeWaves — topological grouping ══════════════════════════

describe("computeWaves grouping", () => {
  it("no deps = 1 wave", () => {
    const w = computeWaves([{ id: "A", targetFiles: [] }, { id: "B", targetFiles: [] }]);
    assert.equal(w.length, 1); assert.equal(w[0].items.length, 2); assert.equal(w[0].phaseId, null);
  });
  it("chain = sequential", () => {
    const w = computeWaves([{ id: "A", targetFiles: [] }, { id: "B", targetFiles: [], dependsOn: ["A"] }, { id: "C", targetFiles: [], dependsOn: ["B"] }]);
    assert.equal(w.length, 3); assert.equal(w[0].items[0].id, "A"); assert.equal(w[2].items[0].id, "C");
  });
  it("diamond = parallel at depth 1", () => {
    const w = computeWaves([{ id: "A", targetFiles: [] }, { id: "B", targetFiles: [], dependsOn: ["A"] }, { id: "C", targetFiles: [], dependsOn: ["A"] }]);
    assert.equal(w.length, 2); assert.equal(w[1].items.length, 2);
  });
  it("phases create boundaries", () => {
    const w = computeWaves([{ id: "P0", targetFiles: [], isParent: true }, { id: "W1", targetFiles: [], parentId: "P0" },
      { id: "P1", targetFiles: [], isParent: true }, { id: "W2", targetFiles: [], parentId: "P1" }]);
    assert.equal(w[0].phaseId, "P0"); assert.equal(w[w.length - 1].phaseId, "P1");
  });
  it("empty = empty", () => assert.deepEqual(computeWaves([]), []));
  it("circular deps still produce all items", () => {
    const w = computeWaves([{ id: "A", targetFiles: [], dependsOn: ["B"] }, { id: "B", targetFiles: [], dependsOn: ["A"] }]);
    assert.deepEqual(w.flatMap(x => x.items.map(i => i.id)).sort(), ["A", "B"]);
  });
  it("external deps = resolved", () => {
    const w = computeWaves([{ id: "A", targetFiles: [], dependsOn: ["EXT"] }, { id: "B", targetFiles: [] }]);
    assert.equal(w.length, 1); assert.equal(w[0].items.length, 2);
  });
});

// ═══ 5. verifyDesignDiagrams ═════════════════════════════════════════

describe("verifyDesignDiagrams", () => {
  it("[] for non-existent dir", () => assert.deepEqual(verifyDesignDiagrams("/x"), []));
  it("detects missing sequenceDiagram", () => {
    const d = resolve(TMP, "dd1"); mkdirSync(d, { recursive: true });
    writeFileSync(resolve(d, "spec.md"), "# Spec\n");
    assert.ok(verifyDesignDiagrams(d).some(v => v.includes("sequenceDiagram")));
  });
  it("passes with sequenceDiagram", () => {
    const d = resolve(TMP, "dd2"); mkdirSync(d, { recursive: true });
    writeFileSync(resolve(d, "spec.md"), "```mermaid\nsequenceDiagram\nA->>B: c\n```\n");
    assert.ok(!verifyDesignDiagrams(d).some(v => v.includes("spec.md")));
  });
  it("checks blueprint.md + domain-model.md", () => {
    const d = resolve(TMP, "dd3"); mkdirSync(d, { recursive: true });
    writeFileSync(resolve(d, "blueprint.md"), "# BP\n");
    writeFileSync(resolve(d, "domain-model.md"), "# DM\n");
    const v = verifyDesignDiagrams(d);
    assert.ok(v.some(x => x.includes("blueprint.md")));
    assert.ok(v.some(x => x.includes("domain-model.md")));
  });
});

// ═══ 6. detectFixLoopStagnation — order invariant ════════════════════

describe("detectFixLoopStagnation order invariant", () => {
  it("spinning is order-insensitive", () => {
    assert.ok(detectFixLoopStagnation([["b","a"],["a","b"]]).includes("spinning"));
  });
  it("no-progress includes counts", () => {
    assert.ok(detectFixLoopStagnation([["e1","e2"],["e3","e4"]]).includes("2"));
  });
});

// ═══ 7. buildDepContextFromManifests — format contract ═══════════════

describe("buildDepContextFromManifests format", () => {
  it("output has header + wave number", () => {
    const r = buildDepContextFromManifests(
      { id: "W2", targetFiles: [], dependsOn: ["W1"] },
      [{ waveIndex: 0, completedItems: ["W1"], changedFiles: ["a.ts"], fileExports: { "a.ts": ["export const x = 1;"] } }],
    );
    assert.ok(r.includes("Dependency Output")); assert.ok(r.includes("Wave 1"));
  });
});

// ═══ 8. New orchestrate/ module barrel exports ══════════════════════

const planning = await import("../dist/platform/orchestrate/planning/index.js");
const execution = await import("../dist/platform/orchestrate/execution/index.js");
const governance = await import("../dist/platform/orchestrate/governance/index.js");
const state = await import("../dist/platform/orchestrate/state/index.js");
const core = await import("../dist/platform/orchestrate/core/index.js");

describe("orchestrate/planning barrel exports", () => {
  const expected = [
    "ID_PATTERN", "PARENT_LABEL_PATTERN",
    "autoFixDesignDiagrams", "autoGenerateWBs",
    "buildPlannerSystemPrompt", "buildSocraticPrompt", "buildAutoPrompt", "buildInlineAutoPrompt", "derivePrefix",
    "classifyHeading", "parseHeading", "scanHeadings",
    "computeWaves", "determinePlannerMode",
    "extractAction", "extractConstraints", "extractContextBudget", "extractDependsOn",
    "extractDone", "extractIntegrationTarget", "extractSizeFromBody", "extractTargetFiles", "extractVerify",
    "findCPSFiles", "loadCPS", "loadPlannerProtocol",
    "findTracks", "resolveTrack", "trackRef",
    "parseFields", "parseWorkBreakdown", "reviewPlan", "runPlannerSession",
    "verifyDesignDiagrams",
  ];
  for (const name of expected) {
    it(`exports ${name}`, () => assert.ok(name in planning, `missing: ${name}`));
  }
  it("all exports are functions or regex", () => {
    for (const name of expected) {
      const val = planning[name];
      assert.ok(typeof val === "function" || val instanceof RegExp, `${name} is ${typeof val}`);
    }
  });
});

describe("orchestrate/execution barrel exports", () => {
  const expected = [
    "selectModelForTask", "HIGH_RISK_DOMAINS", "MEDIUM_RISK_DOMAINS",
    "buildDepContextFromManifests",
    "buildImplementerPrompt",
    "runPreflightCheck", "walkSourceFiles",
    "buildWaveRoster", "canSpawnItem",
    "WaveSessionState",
    "spawnAgent", "saveAgentState", "removeAgentState", "captureAgentOutput", "isAgentComplete",
    "runWaveAuditGates",
    "runFixer", "runFixCycle",
    "runWave", "runWaveAuditLLM",
    "captureSnapshot", "recordWaveManifest", "readPreviousManifests",
  ];
  for (const name of expected) {
    it(`exports ${name}`, () => assert.ok(name in execution, `missing: ${name}`));
  }
});

describe("orchestrate/governance barrel exports", () => {
  const expected = [
    "generateSkeletalRTM", "updateRTM", "updateRTMContent",
    "verifyPhaseCompletion", "isWaveFullyCompleted", "getRetryItems",
    "shouldTriggerRetro", "buildWaveCommitMessage", "waveCommit", "amendWaveCommit", "autoRetro", "autoMerge",
    "collectFitnessSignals", "runFitnessGate", "computeFitness",
    "STUB_PATTERNS", "PERF_PATTERNS",
    "scanLines", "scanForStubs", "scanForPerfAntiPatterns",
    "getChangedFiles", "detectFileScopeViolations", "scanBlueprintViolations",
    "detectOrphanFiles", "auditNewDependencies", "checkTestFileCreation",
    "checkWBConstraints", "detectFixLoopStagnation",
    "runProjectTests", "detectRegressions",
    "runConfluenceCheck", "proposeConfluenceAmendments",
    "runE2EVerification",
  ];
  for (const name of expected) {
    it(`exports ${name}`, () => assert.ok(name in governance, `missing: ${name}`));
  }
});

describe("orchestrate/state barrel exports", () => {
  const expected = [
    "FilesystemCheckpointStore", "FilesystemAgentStateStore",
    "FilesystemManifestStore", "FilesystemRTMStore",
    "resolveTrackDir", "resolveDesignDir", "resolveRTMPath",
    "resolveWBPath", "resolveCheckpointDir", "resolveAgentDir",
  ];
  for (const name of expected) {
    it(`exports ${name}`, () => assert.ok(name in state, `missing: ${name}`));
  }
  it("store constructors are classes", () => {
    for (const cls of ["FilesystemCheckpointStore", "FilesystemAgentStateStore", "FilesystemManifestStore", "FilesystemRTMStore"]) {
      assert.equal(typeof state[cls], "function", `${cls} should be a constructor`);
    }
  });
  it("path resolvers are functions", () => {
    for (const fn of ["resolveTrackDir", "resolveDesignDir", "resolveRTMPath", "resolveWBPath", "resolveCheckpointDir", "resolveAgentDir"]) {
      assert.equal(typeof state[fn], "function", `${fn} should be a function`);
    }
  });
});

describe("orchestrate/core barrel exports", () => {
  const expected = [
    "resolveProviderBinary", "buildProviderArgs",
    "runProviderCLI",
    "detectMuxBackend",
    "spawnMuxSession", "pollMuxCompletion", "cleanupMuxSession",
    "writePromptFile", "writeScriptFile", "cleanupPromptFiles",
  ];
  for (const name of expected) {
    it(`exports ${name}`, () => assert.ok(name in core, `missing: ${name}`));
  }
  it("all exports are functions", () => {
    for (const name of expected) {
      assert.equal(typeof core[name], "function", `${name} should be a function`);
    }
  });
});

// ═══ 9. CLI orchestrate surfaces re-export the canonical symbols ═════════════════

describe("shared.ts re-exports planning symbols", () => {
  it("re-exports all planning symbols used by consumers", () => {
    const requiredFromShared = [
      "DIST", "loadBridge", "findTracks", "resolveTrack", "trackRef",
      "parseWorkBreakdown", "reviewPlan", "computeWaves", "verifyDesignDiagrams",
    ];
    for (const name of requiredFromShared) {
      assert.ok(name in shared, `shared missing: ${name}`);
    }
  });
  it("planning functions delegate to orchestrate/planning/", () => {
    // Same function identity — shared.parseWorkBreakdown === planning.parseWorkBreakdown
    assert.equal(shared.parseWorkBreakdown, planning.parseWorkBreakdown, "parseWorkBreakdown should be same reference");
    assert.equal(shared.reviewPlan, planning.reviewPlan, "reviewPlan should be same reference");
    assert.equal(shared.computeWaves, planning.computeWaves, "computeWaves should be same reference");
    assert.equal(shared.verifyDesignDiagrams, planning.verifyDesignDiagrams, "verifyDesignDiagrams should be same reference");
    assert.equal(shared.findTracks, planning.findTracks, "findTracks should be same reference");
    assert.equal(shared.resolveTrack, planning.resolveTrack, "resolveTrack should be same reference");
    assert.equal(shared.trackRef, planning.trackRef, "trackRef should be same reference");
  });
});

describe("planner.ts re-exports planning symbols", () => {
  it("re-exports planning symbols", () => {
    const requiredFromPlanner = ["interactivePlanner", "autoGenerateWBs", "autoFixDesignDiagrams"];
    for (const name of requiredFromPlanner) {
      assert.ok(name in planner, `planner missing: ${name}`);
    }
  });
  it("auto functions delegate to orchestrate/planning/", () => {
    assert.equal(planner.autoGenerateWBs, planning.autoGenerateWBs, "autoGenerateWBs should be same reference");
    assert.equal(planner.autoFixDesignDiagrams, planning.autoFixDesignDiagrams, "autoFixDesignDiagrams should be same reference");
  });
});

describe("runner.ts re-exports execution and governance symbols", () => {
  it("re-exports governance symbols", () => {
    const fromGovernance = [
      "collectFitnessSignals", "runFitnessGate",
      "scanLines", "scanForStubs", "scanForPerfAntiPatterns",
      "getChangedFiles", "detectFileScopeViolations", "scanBlueprintViolations",
      "detectOrphanFiles", "auditNewDependencies", "checkTestFileCreation",
      "checkWBConstraints", "detectFixLoopStagnation",
      "runProjectTests", "detectRegressions",
      "updateRTM", "waveCommit",
    ];
    for (const name of fromGovernance) {
      assert.ok(name in runner, `runner missing governance re-export: ${name}`);
    }
  });
  it("re-exports execution symbols", () => {
    const fromExecution = [
      "runPreflightCheck", "walkSourceFiles",
      "buildDepContextFromManifests",
      "spawnAgent", "captureAgentOutput", "isAgentComplete",
      "buildWaveRoster", "canSpawnItem",
      "WaveSessionState",
      "runWaveAuditGates",
    ];
    for (const name of fromExecution) {
      assert.ok(name in runner, `runner missing execution re-export: ${name}`);
    }
  });
  it("governance functions delegate to orchestrate/governance/", () => {
    assert.equal(runner.waveCommit, governance.waveCommit, "waveCommit should be same reference");
    assert.equal(runner.updateRTM, governance.updateRTM, "updateRTM should be same reference");
    assert.equal(runner.collectFitnessSignals, governance.collectFitnessSignals, "collectFitnessSignals same ref");
    assert.equal(runner.runFitnessGate, governance.runFitnessGate, "runFitnessGate same ref");
    assert.equal(runner.detectFixLoopStagnation, governance.detectFixLoopStagnation, "detectFixLoopStagnation same ref");
  });
  it("execution functions delegate to orchestrate/execution/", () => {
    assert.equal(runner.buildDepContextFromManifests, execution.buildDepContextFromManifests, "buildDepContextFromManifests same ref");
    assert.equal(runner.spawnAgent, execution.spawnAgent, "spawnAgent same ref");
    assert.equal(runner.captureAgentOutput, execution.captureAgentOutput, "captureAgentOutput same ref");
    assert.equal(runner.isAgentComplete, execution.isAgentComplete, "isAgentComplete same ref");
    assert.equal(runner.buildWaveRoster, execution.buildWaveRoster, "buildWaveRoster same ref");
    assert.equal(runner.canSpawnItem, execution.canSpawnItem, "canSpawnItem same ref");
    assert.equal(runner.WaveSessionState, execution.WaveSessionState, "WaveSessionState same ref");
    assert.equal(runner.runWaveAuditGates, execution.runWaveAuditGates, "runWaveAuditGates same ref");
  });
});

const lifecycle = await import("../dist/platform/cli/commands/orchestrate/lifecycle.js");

describe("lifecycle.ts re-exports governance lifecycle symbols", () => {
  it("re-exports governance lifecycle symbols", () => {
    assert.ok("autoRetro" in lifecycle, "lifecycle missing autoRetro");
    assert.ok("autoMerge" in lifecycle, "lifecycle missing autoMerge");
  });
  it("delegates to orchestrate/governance/", () => {
    assert.equal(lifecycle.autoRetro, governance.autoRetro, "autoRetro same ref");
    assert.equal(lifecycle.autoMerge, governance.autoMerge, "autoMerge same ref");
  });
});
