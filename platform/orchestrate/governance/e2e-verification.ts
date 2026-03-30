/**
 * E2E verification — track-level final gate.
 *
 * Runs after all waves complete: re-runs verify commands, final fitness,
 * final project tests, stub/perf/blueprint scans, AST cross-file analysis,
 * auto-learn, normal form convergence report.
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

import type { NamingRule } from "../../bus/blueprint-parser.js";
import type { Bridge } from "../planning/types.js";
import { analyzeAndSuggest } from "../../bus/auto-learn.js";
import { generateConvergenceReport } from "../../bus/normal-form.js";
import { runFitnessGate } from "./fitness-gates.js";
import { runRuntimeEvaluationGate } from "./runtime-evaluation-gate.js";
import { createRuntimeEvaluationSpec, createEvaluationScenario } from "../../core/harness/runtime-evaluation-spec.js";
import { CliSessionEvaluator } from "../../providers/evaluators/cli-session.js";
import { ArtifactValidatorEvaluator } from "../../providers/evaluators/artifact-validator.js";
import {
  STUB_PATTERNS, PERF_PATTERNS,
  scanLines, scanBlueprintViolations, detectOrphanFiles,
  runProjectTests,
} from "./scope-gates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "..", "..");

const ALLOWED_VERIFY_PREFIXES = [
  "npm ", "npx ", "node ", "tsc ", "eslint ", "vitest ",
  "go ", "cargo ", "python ", "pytest ", "pip ",
  "java ", "javac ", "mvn ", "gradle ",
];

/** Shell metacharacters that enable command chaining/injection (incl. Windows %VAR% expansion). */
const SHELL_META = /[;&|`$><\r\n%]/;

interface WorkItemLike {
  id: string;
  targetFiles: string[];
  verify?: string;
}

interface WaveLike {
  items: WorkItemLike[];
}

/**
 * Run E2E verification gate after all waves complete.
 * This is the track-level final quality gate.
 */
export async function runE2EVerification(
  repoRoot: string, waves: WaveLike[], blueprintRules: NamingRule[],
  bridge: Bridge | null, trackName: string, totalWBs: number,
): Promise<void> {
  console.log("\n  \x1b[36m◈ E2E Verification — track-level final gate\x1b[0m");
  let e2ePassed = true;

  // 1. Re-run ALL verify commands
  const allItems = waves.flatMap(w => w.items);
  let verifyFails = 0;
  for (const item of allItems) {
    if (!item.verify) continue;
    const trimmed = item.verify.trim();
    const INTERP_RE = /\s-[ec]\s|\s-[ec]$|\s--eval[\s=]|\s--command[\s=]/;
    if (SHELL_META.test(trimmed) || INTERP_RE.test(` ${trimmed}`) || !ALLOWED_VERIFY_PREFIXES.some(p => trimmed.startsWith(p))) {
      console.log(`    \x1b[31m✗ ${item.id} verify blocked (not in allowlist or contains shell metacharacters): ${item.verify}\x1b[0m`);
      verifyFails++;
      e2ePassed = false;
      continue;
    }
    const parts = trimmed.split(/\s+/);
    try {
      execFileSync(parts[0], parts.slice(1), {
        cwd: repoRoot, timeout: 60_000, stdio: "pipe", windowsHide: true,
        shell: process.platform === "win32",
      });
    } catch {
      console.log(`    \x1b[31m✗ ${item.id} verify failed: ${item.verify}\x1b[0m`);
      verifyFails++;
      e2ePassed = false;
    }
  }
  if (verifyFails === 0) console.log(`    \x1b[32m✓ All ${allItems.filter(i => i.verify).length} verify commands passed\x1b[0m`);

  // 2. Final fitness score
  const allFiles = [...new Set(allItems.flatMap(i => i.targetFiles))];
  const finalFg = runFitnessGate(repoRoot, allFiles, bridge?.store ?? null);
  const fColor = finalFg.score >= 0.7 ? "32" : finalFg.score >= 0.4 ? "33" : "31";
  console.log(`    \x1b[${fColor}m◈ Final fitness: ${finalFg.score.toFixed(2)}\x1b[0m`);
  if (finalFg.decision === "auto-reject") {
    console.log(`    \x1b[31m✗ Final fitness below threshold\x1b[0m`);
    e2ePassed = false;
  }

  // 3. Final project tests
  const finalTests = runProjectTests(repoRoot);
  if (finalTests.ran) {
    if (finalTests.passed) {
      console.log(`    \x1b[32m✓ Project tests passed\x1b[0m`);
    } else {
      console.log(`    \x1b[31m✗ Project tests failed: ${finalTests.summary}\x1b[0m`);
      e2ePassed = false;
    }
  }

  // 4. Runtime evaluation gate (surface-matched, PLT-6H/A-4)
  try {
    const verifyItems = allItems.filter(i => i.verify);
    const artifactFiles = allFiles.filter(f => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".mjs"));
    const scenarios = [
      ...verifyItems.map(item => createEvaluationScenario({
        surface: "cli", target: item.id, verifier: item.verify!, blocking: true,
      })),
      ...artifactFiles.slice(0, 20).map(f => createEvaluationScenario({
        surface: "artifact", target: f, blocking: false,
      })),
    ];
    if (scenarios.length > 0) {
      const spec = createRuntimeEvaluationSpec({ scenarios });
      const evaluators = [new CliSessionEvaluator(repoRoot), new ArtifactValidatorEvaluator(repoRoot)];
      const rtResult = await runRuntimeEvaluationGate(spec, evaluators);
      if (rtResult.passed) {
        console.log(`    \x1b[32m✓ Runtime evaluation passed (${rtResult.surfaceResults.length} surface(s))\x1b[0m`);
      } else {
        console.log(`    \x1b[31m✗ Runtime evaluation failed\x1b[0m`);
        for (const f of rtResult.blockingFailures.slice(0, 5)) console.log(`      ✗ ${f}`);
        e2ePassed = false;
      }
    }
  } catch { /* fail-open: evaluator infrastructure unavailable */ }

  // 5-9: Final scans
  const e2eChecks: Array<{ name: string; items: string[]; blocker: boolean }> = [
    { name: "Stubs", items: scanLines(repoRoot, allFiles, STUB_PATTERNS), blocker: true },
    { name: "Perf anti-patterns", items: scanLines(repoRoot, allFiles, PERF_PATTERNS), blocker: false },
    ...(blueprintRules.length > 0
      ? [{ name: "Blueprint naming", items: scanBlueprintViolations(repoRoot, allFiles, blueprintRules), blocker: true }]
      : []),
    { name: "Orphan files", items: detectOrphanFiles(repoRoot, allFiles), blocker: false },
  ];
  for (const { name, items, blocker } of e2eChecks) {
    if (items.length > 0) {
      const color = blocker ? "31" : "33";
      const icon = blocker ? "✗" : "⚠";
      console.log(`    \x1b[${color}m${icon} ${items.length} ${name.toLowerCase()}\x1b[0m`);
      for (const x of items.slice(0, 5)) console.log(`      ${icon} ${x}`);
      if (blocker) e2ePassed = false;
    } else {
      console.log(`    \x1b[32m✓ No ${name.toLowerCase()}\x1b[0m`);
    }
  }

  // AST cross-file analysis
  const tsconfigPath = resolve(repoRoot, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const { ASTAnalyzer } = await import(pathToFileURL(resolve(DIST, "providers", "ast-analyzer.js")).href);
      const analyzer = new ASTAnalyzer({ mode: "program", tsconfigPath });
      const pr = analyzer.analyzeProgram(tsconfigPath);

      for (const [arr, label, isBl] of [
        [pr.importCycles, "import cycle(s)", true],
        [pr.contractDrifts, "contract drift(s)", true],
      ] as const) {
        if (arr.length > 0) {
          console.log(`    \x1b[31m✗ ${arr.length} ${label}\x1b[0m`);
          for (const x of arr.slice(0, 3)) console.log(`      ✗ ${"files" in x ? (x as any).files.join(" → ") : `${(x as any).violationFile}:${(x as any).violationLine} — ${(x as any).kind}`}`);
          if (isBl) e2ePassed = false;
        } else {
          console.log(`    \x1b[32m✓ No ${label}\x1b[0m`);
        }
      }

      if (pr.unusedExports.length > 0) {
        const relevant = pr.unusedExports.filter((u: any) =>
          allFiles.some(f => u.file?.includes(f) || f.includes(u.file ?? "")));
        if (relevant.length > 0) {
          console.log(`    \x1b[33m⚠ ${relevant.length} unused export(s)\x1b[0m`);
          for (const u of relevant.slice(0, 5)) console.log(`      ⚠ ${(u as any).file}:${(u as any).line} — ${(u as any).name}`);
        }
      }
    } catch { /* fail-open */ }
  }

  if (e2ePassed) {
    console.log(`  \x1b[32m✓ E2E verification passed\x1b[0m\n`);
  } else {
    console.log(`  \x1b[33m⚠ E2E verification found issues — review before shipping\x1b[0m\n`);
  }

  console.log("  \x1b[32m✓ Track complete!\x1b[0m\n");
  if (bridge?.emitEvent) {
    bridge.emitEvent("track.complete", "generic", { trackId: trackName, total: totalWBs, e2ePassed });
  }

  // Auto-learn
  if (bridge?.store) {
    try {
      const learning = analyzeAndSuggest(bridge.store as any);
      if (learning.suggestions.length > 0) {
        console.log(`  \x1b[35m◈ Auto-learn: ${learning.suggestions.length} rule suggestion(s)\x1b[0m`);
        for (const s of learning.suggestions.slice(0, 3)) {
          console.log(`    → ${s.ruleText.slice(0, 80)}${s.ruleText.length > 80 ? "..." : ""} (confidence: ${(s.confidence * 100).toFixed(0)}%)`);
        }
      }
      if (learning.stagnationLearnings.length > 0) {
        console.log(`  \x1b[35m◈ Stagnation learnings: ${learning.stagnationLearnings.length} trigger boost(s)\x1b[0m`);
      }
    } catch { /* fail-open */ }
  }

  // Normal Form convergence report
  if (bridge?.store) {
    try {
      const report = generateConvergenceReport(bridge.store as any);
      if (report.providers.length > 0) {
        console.log(`  \x1b[35m◈ Normal Form convergence:\x1b[0m`);
        for (const p of report.providers) {
          const icon = p.normalFormReached ? "✓" : p.regressed ? "✗" : "◈";
          const color = p.normalFormReached ? "32" : p.regressed ? "31" : "33";
          console.log(`    \x1b[${color}m${icon}\x1b[0m ${p.provider}: ${p.currentStage} (${p.totalRounds} rounds)`);
        }
        if (report.allConverged) {
          console.log(`  \x1b[32m✓ All providers converged to Normal Form\x1b[0m`);
        }
      }
    } catch { /* fail-open */ }
  }
}
