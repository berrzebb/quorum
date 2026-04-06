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
import type { FitnessGateResult } from "../governance/fitness-gates.js";
import { invalidateTscCache } from "../governance/fitness-gates.js";
import type { WorkItem } from "../planning/types.js";
import { prepareProviderSpawn } from "../core/provider-binary.js";
import { partitionFindings, type FindingSeverity } from "../governance/scope-gates.js";

// ── Types ────────────────────────────────────

/** Options for a single fixer invocation. */
export interface FixerOptions {
  repoRoot: string;
  findings: string[];
  files: string[];
  provider: string;
  fitnessContext?: FitnessGateResult;
  /** Findings from previous rounds — fixer must not regress these. */
  previousFindings?: string[][];
}

/** Result of a single fixer invocation. */
export interface FixerResult {
  /** Whether the fixer completed without error. */
  completed: boolean;
}

/** Default max fix rounds — can be overridden via config or CLI. */
export const DEFAULT_MAX_FIX_ROUNDS = 3;

/** Options for the full fix-retry cycle. */
export interface FixCycleOptions {
  repoRoot: string;
  files: string[];
  /** Auditor provider — used for re-audit between fix rounds. */
  provider: string;
  /** Fixer provider — used for spawning fix agents. Defaults to provider if not set. */
  fixerProvider?: string;
  /** Max fix rounds. Defaults to DEFAULT_MAX_FIX_ROUNDS (3). */
  maxRounds?: number;
  fitnessContext?: FitnessGateResult;
  /** Function to run the LLM audit and return findings. */
  auditFn: (repoRoot: string, files: string[], items: WorkItem[], provider: string) => Promise<{ passed: boolean; findings: string[] }>;
  /** Work items completed in this wave (passed to auditFn). */
  completedItems: WorkItem[];
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
  const { repoRoot, findings, files, provider, fitnessContext, previousFindings } = opts;

  const fileList = [...new Set(files)].slice(0, 15).map(f => `- ${f}`).join("\n");
  const findingList = findings.map(f => `- ${f}`).join("\n");

  let fitnessSection = "";
  if (fitnessContext && fitnessContext.components) {
    const weak = fitnessContext.components.filter((c) => c.score < 0.5);
    if (weak.length > 0) {
      fitnessSection = [
        "",
        `## Fitness Score: ${fitnessContext.score.toFixed(2)} (${fitnessContext.decision})`,
        "Weak components (prioritize fixes here):",
        ...weak.map((c) => `- **${c.name}**: ${c.score.toFixed(2)}`),
      ].join("\n");
    }
  }

  // Convergence-loop step 4: ANALYZE — what changed since last iteration?
  let contextSection = "";
  if (previousFindings && previousFindings.length > 0) {
    const currentSet = new Set(findings);
    const prevRound = previousFindings[previousFindings.length - 1] ?? [];
    const prevSet = new Set(prevRound);

    const fixed = prevRound.filter(f => !currentSet.has(f));
    const recurring = findings.filter(f => prevSet.has(f));
    const newFindings = findings.filter(f => !prevSet.has(f));

    const parts: string[] = ["", `## Context — Round ${previousFindings.length + 1} of fix cycle`];

    if (fixed.length > 0) {
      parts.push("", "### Successfully fixed last round (preserve these):");
      parts.push(...fixed.slice(0, 15).map(f => `- ✅ ${f}`));
    }
    if (recurring.length > 0) {
      parts.push("", "### Still failing (previous fix was insufficient or reverted):");
      parts.push(...recurring.slice(0, 15).map(f => `- ⚠ ${f}`));
    }
    if (newFindings.length > 0) {
      parts.push("", "### New findings this round:");
      parts.push(...newFindings.slice(0, 15).map(f => `- 🆕 ${f}`));
    }

    parts.push("", "When fixing new/recurring issues, verify that previously fixed issues remain resolved.");
    contextSection = parts.join("\n");
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
    contextSection,
    "",
    "## Instructions:",
    "1. Read each affected file",
    "2. Fix the specific issues listed in the findings",
    "3. Do NOT rewrite or restructure — only fix the identified issues",
    "4. Preserve fixes from previous rounds — do NOT regress",
    "5. Run compilation/type checks and tests to verify",
    "6. Do NOT commit — only edit files. The caller handles git commits.",
    "7. Do NOT ask questions or wait for confirmation — fix everything and exit.",
  ].join("\n");

  const spawn = await prepareProviderSpawn(provider, prompt);

  const result = spawnSync(spawn.bin, spawn.args, {
    cwd: repoRoot,
    input: spawn.stdinInput,
    stdio: [spawn.stdinInput ? "pipe" : "ignore", "inherit", "inherit"],
    env: { ...process.env },
    timeout: 300_000,
    windowsHide: true,
  });

  // Fixer modifies source files → invalidate tsc cache so next fitness gate re-checks
  invalidateTscCache();

  return { completed: result.status === 0 || result.status === null };
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
    repoRoot, files, provider,
    fitnessContext, auditFn, completedItems, detectStagnation,
  } = opts;
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_FIX_ROUNDS;
  const fixer = opts.fixerProvider ?? provider;

  // Collect all in-scope file paths for filtering out-of-scope findings
  const scopeFiles = new Set(completedItems.flatMap(i => i.targetFiles));

  const findingsHistory: string[][] = [];
  let attempts = 0;
  let stagnation: string | undefined;

  while (true) {
    attempts++;

    const auditResult = await auditFn(repoRoot, files, completedItems, provider);

    if (auditResult.passed) {
      return { passed: true, attempts, findingsHistory };
    }

    // Separate in-scope vs out-of-scope findings.
    // Out-of-scope findings reference files not in any WB's targetFiles —
    // the fixer can't resolve these and they shouldn't cause stagnation.
    const inScope: string[] = [];
    const outOfScope: string[] = [];
    for (const f of auditResult.findings) {
      // Check if finding references an out-of-scope file path
      const refsOutOfScope = scopeFiles.size > 0 && !Array.from(scopeFiles).some(sf => f.includes(sf));
      if (refsOutOfScope && /[a-z]+\.[a-z]+:\d+/i.test(f)) {
        outOfScope.push(f);
      } else {
        inScope.push(f);
      }
    }

    // If ALL remaining findings are out-of-scope, treat as pass
    if (inScope.length === 0 && outOfScope.length > 0) {
      return { passed: true, attempts, findingsHistory };
    }

    // [FIX FR-8~10] Fix-first: classify findings by severity
    const { autoFixable, reviewRequired, blocking } = partitionFindings(inScope);

    // Blocking findings (critical/high) → fail immediately, no auto-fix attempt
    if (blocking.length > 0 && autoFixable.length === 0 && reviewRequired.length === 0) {
      findingsHistory.push([...inScope]);
      return { passed: false, attempts, stagnation: `${blocking.length} blocking finding(s)`, findingsHistory };
    }

    // Only track in-scope findings for stagnation detection
    findingsHistory.push([...inScope]);

    if (attempts >= 2 && detectStagnation) {
      const stag = detectStagnation(findingsHistory);
      if (stag) {
        stagnation = stag;
        return { passed: false, attempts, stagnation, findingsHistory };
      }
    }

    if (attempts >= maxRounds) {
      return { passed: false, attempts, stagnation, findingsHistory };
    }

    // Only pass fixable findings to fixer — blocking findings need human/audit review.
    // Include previous findings so fixer knows what was already fixed and must be preserved.
    const fixableFindings = [...autoFixable, ...reviewRequired];
    await runFixer({
      repoRoot,
      findings: fixableFindings.length > 0 ? fixableFindings : inScope,
      files,
      provider: fixer,
      fitnessContext,
      previousFindings: findingsHistory.slice(0, -1), // all except current round
    });
  }
}
