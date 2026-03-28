/**
 * Fixer loop — spawn fixer agents on audit failure, retry up to max rounds.
 *
 * Extracted from runner.ts. Handles:
 *   1. Single fixer invocation (runFixer)
 *   2. Full fix-retry cycle (runFixCycle) — audit -> fix -> re-audit loop
 *
 * No console output, no wave scheduling, no gate implementations.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { FitnessGateResult } from "../governance/fitness-gates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────

/** Options for a single fixer invocation. */
export interface FixerOptions {
  repoRoot: string;
  findings: string[];
  files: string[];
  provider: string;
  fitnessContext?: FitnessGateResult;
}

/** Result of a single fixer invocation. */
export interface FixerResult {
  /** Whether the fixer completed without error. */
  completed: boolean;
}

/** Options for the full fix-retry cycle. */
export interface FixCycleOptions {
  repoRoot: string;
  files: string[];
  provider: string;
  maxRounds: number;
  fitnessContext?: FitnessGateResult;
  /** Function to run the LLM audit and return findings. */
  auditFn: (repoRoot: string, files: string[], items: any[], provider: string) => Promise<{ passed: boolean; findings: string[] }>;
  /** Work items completed in this wave (passed to auditFn). */
  completedItems: any[];
  /** Stagnation detection function (injected from governance/scope-gates). */
  detectStagnation?: (history: string[][]) => string | null;
}

/** Result of the full fix-retry cycle. */
export interface FixCycleResult {
  /** Whether the audit ultimately passed. */
  passed: boolean;
  /** Total fix attempts made. */
  attempts: number;
  /** Last stagnation message (if detected). */
  stagnation?: string;
  /** Findings from each attempt (for diagnostics). */
  findingsHistory: string[][];
}

// ── Single Fixer Invocation ─────────────────

/**
 * Spawn a fixer agent to address specific audit findings.
 * Fixer reads existing code + audit findings and applies targeted fixes.
 * Different from implementer: no fresh implementation, just bug fixing.
 */
export async function runFixer(opts: FixerOptions): Promise<FixerResult> {
  const { repoRoot, findings, files, provider, fitnessContext } = opts;

  const quorumRoot = resolve(__dirname, "..", "..", "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  const fileList = [...new Set(files)].slice(0, 15).map(f => `- ${f}`).join("\n");
  const findingList = findings.map(f => `- ${f}`).join("\n");

  // Build fitness context section for fixer
  let fitnessSection = "";
  if (fitnessContext && fitnessContext.components) {
    const weak = fitnessContext.components.filter((c: any) => c.score < 0.5);
    if (weak.length > 0) {
      fitnessSection = [
        "",
        `## Fitness Score: ${fitnessContext.score.toFixed(2)} (${fitnessContext.decision})`,
        "Weak components (prioritize fixes here):",
        ...weak.map((c: any) => `- **${c.name}**: ${c.score.toFixed(2)}`),
      ].join("\n");
    }
  }

  const prompt = [
    "# Fixer — Address Audit Findings",
    "",
    "## Audit Findings (fix ALL of these):",
    findingList,
    "",
    "## Affected Files:",
    fileList,
    fitnessSection,
    "",
    "## Instructions:",
    "1. Read each affected file",
    "2. Fix the specific issues listed in the findings",
    "3. Run compilation check (tsc --noEmit or equivalent)",
    "4. Do NOT rewrite or restructure — only fix the identified issues",
    "5. Run any available tests to verify your fixes",
  ].join("\n");

  spawnSync(bin, ["-p", prompt, "--dangerously-skip-permissions"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
    timeout: 180_000,
  });

  return { completed: true };
}

// ── Fix-Retry Cycle ─────────────────────────

/**
 * Run the full fix-retry cycle: audit -> fix -> re-audit, up to maxRounds.
 *
 * Returns structured result with pass/fail, attempt count, and diagnostics.
 * No console output — caller handles presentation.
 */
export async function runFixCycle(opts: FixCycleOptions): Promise<FixCycleResult> {
  const {
    repoRoot, files, provider, maxRounds,
    fitnessContext, auditFn, completedItems, detectStagnation,
  } = opts;

  const findingsHistory: string[][] = [];
  let attempts = 0;
  let stagnation: string | undefined;

  while (true) {
    attempts++;

    const auditResult = await auditFn(repoRoot, files, completedItems, provider);

    if (auditResult.passed) {
      return { passed: true, attempts, findingsHistory };
    }

    // Track findings for stagnation detection
    findingsHistory.push([...auditResult.findings]);

    // Stagnation detection (mechanical: compare findings across fix attempts)
    if (attempts >= 2 && detectStagnation) {
      const stag = detectStagnation(findingsHistory);
      if (stag) {
        stagnation = stag;
        if (attempts >= maxRounds) {
          return { passed: false, attempts, stagnation, findingsHistory };
        }
      }
    }

    if (attempts >= maxRounds) {
      return { passed: false, attempts, stagnation, findingsHistory };
    }

    // Spawn fixer for this round
    await runFixer({
      repoRoot,
      findings: auditResult.findings,
      files,
      provider,
      fitnessContext,
    });
  }
}
