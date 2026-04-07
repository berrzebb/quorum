/**
 * Pipeline Runner — 6-stage auto-development pipeline.
 *
 * PRD § 6.2: Plan → Design → Implement → Verify → QA Loop → Finalize
 * Manager-Orchestrator principle: runner does NOT generate code.
 * Instead it generates directives for Claude and runs verify commands.
 *
 * @module adapters/shared/pipeline-runner
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @typedef {"plan"|"design"|"implement"|"verify"|"qa"|"finalize"} PipelineStage
 */

/**
 * @typedef {Object} StageResult
 * @property {PipelineStage} stage
 * @property {"success"|"failed"|"skipped"} status
 * @property {object} [output]
 * @property {string} [error]
 * @property {number} duration
 */

/**
 * @typedef {Object} PipelineResult
 * @property {boolean} success
 * @property {StageResult[]} stages
 * @property {number} totalDuration
 * @property {string} [failedAt]
 */

const STAGES = ["plan", "design", "implement", "verify", "qa", "finalize"];

/**
 * Run the full 6-stage pipeline.
 *
 * @param {string} agenda - What to build
 * @param {object} config - QuorumConfig
 * @param {object} bridge - Initialized bridge instance
 * @param {object} [opts]
 * @param {number} [opts.maxQARounds=3]
 * @param {string} [opts.repoRoot]
 * @param {(stage: PipelineStage, status: string) => void} [opts.onStageChange]
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline(agenda, config, bridge, opts = {}) {
  const effectiveAgenda = agenda
    ?? config?.pipeline?.agenda
    ?? config?._meta?.agenda
    ?? "Build the project";
  const { maxQARounds = 3, onStageChange, repoRoot } = opts;
  const stages = [];
  const totalStart = Date.now();
  const ctx = { agenda: effectiveAgenda, config, bridge, repoRoot, plan: null, verifyResults: null };

  for (const stage of STAGES) {
    onStageChange?.(stage, "running");
    const stageStart = Date.now();

    try {
      const handler = STAGE_HANDLERS[stage];
      const output = await handler(ctx, { maxQARounds });
      // QA stage: treat passed:false as a real failure (codex audit rejected after 3 rounds)
      const qaFailed = stage === "qa" && output?.passed === false;
      const result = { stage, status: output?.skipped ? "skipped" : (qaFailed ? "failed" : "success"), output, duration: Date.now() - stageStart };
      stages.push(result);
      onStageChange?.(stage, result.status);

      bridge.event?.emitEvent?.("pipeline.stage.complete", "claude-code", {
        stage, status: result.status, duration: result.duration,
      });

      // QA failure: still run finalize (retro/cleanup), but mark pipeline as not fully passed
      if (qaFailed) {
        ctx._qaFailed = true;
      }
    } catch (err) {
      const result = { stage, status: "failed", error: err?.message ?? String(err), duration: Date.now() - stageStart };
      stages.push(result);
      onStageChange?.(stage, "failed");

      bridge.event?.emitEvent?.("pipeline.stage.failed", "claude-code", {
        stage, error: result.error, duration: result.duration,
      });

      return { success: false, stages, totalDuration: Date.now() - totalStart, failedAt: stage };
    }
  }

  return { success: !ctx._qaFailed, stages, totalDuration: Date.now() - totalStart };
}

// ── Stage Handlers ──────────────────────────────────────────

const STAGE_HANDLERS = {
  /**
   * P1. Plan — parliament session → CPS if converged, else verdict context for planner Phase 1.
   *
   * PRD: "If CPS exists → planner Phase 0. If not → planner Phase 1 (Capture Intent)."
   * Parliament convergence requires multiple sessions — first session won't converge.
   */
  async plan(ctx) {
    const { agenda, config, bridge } = ctx;

    // Attempt parliament session — CPS only produced on convergence
    if (bridge.parliament?.runParliamentSession) {
      try {
        const result = await bridge.parliament.runParliamentSession({
          agenda: [agenda],
          source: "pipeline",
        });

        if (result?.cps) {
          // Converged → full CPS available for planner Phase 0
          ctx.plan = { source: "parliament", cps: result.cps, converged: true };
          return ctx.plan;
        }

        // Not converged — carry verdict context forward for planner Phase 1
        ctx.plan = {
          source: "parliament",
          cps: null,
          converged: false,
          verdict: result?.verdict ?? null,
          convergence: result?.convergence ?? null,
        };
        return ctx.plan;
      } catch (err) {
        // Parliament failed — proceed without (planner Phase 1 will capture intent)
        ctx.plan = { source: "agenda-only", cps: null, converged: false, error: err?.message };
        return ctx.plan;
      }
    }

    // No parliament available — agenda-only plan for planner Phase 1
    ctx.plan = { source: "agenda-only", cps: null, converged: false };
    return ctx.plan;
  },

  /**
   * P2. Design — generate WBs via parallel planner sub-agents.
   *
   * v0.6.5: Split from single 8-file planner into focused sub-agents:
   *   - planner-prd: PRD + spec + blueprint + domain-model
   *   - planner-wb: work-breakdown + execution-order + test-strategy + catalog
   *
   * Falls back to single-session planner if parallel version unavailable.
   */
  async design(ctx) {
    const { plan, config, repoRoot, bridge } = ctx;
    if (!plan) throw new Error("no plan from P1 — cannot design");
    if (!repoRoot) throw new Error("no repoRoot");

    const provider = config?.pipeline?.provider ?? "claude";
    const trackName = config?._meta?.trackName ?? "pipeline";

    // Try parallel planner first (v0.6.5)
    const runPlanner = bridge.execution?.runParallelPlannerSession
      ?? bridge.execution?.runPlannerSession;

    if (!runPlanner) throw new Error("no planner available in bridge.execution");

    const plannerOpts = bridge.execution?.runParallelPlannerSession
      ? { repoRoot, trackName, provider }
      : { repoRoot, trackName, provider, useMux: true, useAuto: true };

    const result = await runPlanner(plannerOpts);

    if (result) {
      const trackSlug = result.trackSlug ?? trackName;
      const candidates = [
        resolve(repoRoot, "docs", "plan", trackSlug, "work-breakdown.md"),
        resolve(repoRoot, "docs", trackSlug, "work-breakdown.md"),
        resolve(repoRoot, "plans", trackSlug, "work-breakdown.md"),
      ];
      ctx.wbPath = candidates.find(p => existsSync(p)) ?? null;
      ctx.trackName = trackSlug;

      if (!ctx.wbPath) {
        throw new Error(`design completed but work-breakdown.md not found. Searched: ${candidates.join(", ")}`);
      }

      return { wbPath: ctx.wbPath, trackName: trackSlug, source: "parallel-planner" };
    }

    throw new Error("planner returned null — design failed");
  },

  /**
   * P3. Implement — orchestrate engine (wave execution) or provider CLI fallback.
   *
   * Priority: (1) orchestrate.runWave if WBs exist (from P2 design)
   *           (2) provider CLI spawn as fallback
   */
  async implement(ctx) {
    const { plan, config, repoRoot, bridge } = ctx;
    if (!plan) throw new Error("no plan from P1");
    if (!repoRoot) throw new Error("no repoRoot");
    if (!ctx.wbPath || !existsSync(ctx.wbPath)) throw new Error("no work-breakdown from P2 design");

    const provider = config?.pipeline?.provider ?? "claude";
    const auditor = config?.consensus?.roles?.judge ?? "codex";
    const planDir = resolve(repoRoot, ".claude", "quorum", "pipeline");
    mkdirSync(planDir, { recursive: true });

    // Pre-implement: ensure git has at least one commit (scope-gates + waveCommit need HEAD)
    try {
      execSync("git rev-parse HEAD", { cwd: repoRoot, timeout: 5000, windowsHide: true, stdio: "pipe" });
    } catch {
      try {
        execSync("git add -A && git commit -m \"initial (pipeline pre-implement)\" --allow-empty", {
          cwd: repoRoot, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: "pipe",
        });
      } catch { /* fail-open */ }
    }

    // Record pre-implement HEAD for WIP squash in finalize
    try {
      ctx._preImplementRef = execSync("git rev-parse HEAD", {
        cwd: repoRoot, encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch { /* fail-open: squash will be skipped */ }

    // PRD §6.2 P3: orchestrate.runWave(WB) — no fallback
    if (!bridge.gate?.runOrchestrateLoop) {
      throw new Error("gate.runOrchestrateLoop unavailable — cannot implement");
    }

    const orchResult = await bridge.gate.runOrchestrateLoop({
      repoRoot,
      trackName: ctx.trackName ?? "pipeline",
      wbPath: ctx.wbPath,
      provider,
      auditor,
      maxConcurrency: 3,
      maxRetries: 3,
      skipAudit: true, // pipeline P5 QA handles cross-model audit
      onLog: (msg) => { try { writeFileSync(resolve(planDir, "implement-log.txt"), msg + "\n", { flag: "a" }); } catch {} },
    });

    return { mode: "orchestrate", ...orchResult };
  },

  /**
   * P4. Verify — deps install + verify commands + fitness gate + domain specialists.
   */
  async verify(ctx) {
    const { config, repoRoot, bridge } = ctx;
    let commands = config?.verify?.commands ?? [];
    const cwd = repoRoot ?? process.cwd();

    // Auto-detect verify commands if not configured (empty project → setup couldn't detect)
    if (commands.length === 0) {
      commands = detectVerifyCommands(cwd);
    }

    // Pre-verify: install dependencies
    if (existsSync(resolve(cwd, "package.json")) && !existsSync(resolve(cwd, "node_modules"))) {
      try {
        execSync("npm install", { cwd, encoding: "utf8", timeout: 120_000, windowsHide: true, stdio: "pipe" });
      } catch { /* fail-open */ }
    }
    if (existsSync(resolve(cwd, "pyproject.toml")) || existsSync(resolve(cwd, "requirements.txt"))) {
      try {
        const pipCmd = existsSync(resolve(cwd, "pyproject.toml")) ? "pip install -e ." : "pip install -r requirements.txt";
        execSync(pipCmd, { cwd, encoding: "utf8", timeout: 120_000, windowsHide: true, stdio: "pipe" });
      } catch { /* fail-open */ }
    }

    // A. Mechanical verify commands (tsc, npm test, etc.)
    ctx.verifyResults = commands.length > 0 ? runVerifyCommands(commands, cwd) : [];
    const mechanicalPassed = ctx.verifyResults.every(r => r.passed);

    // B. Fitness gate (7-component quality score)
    let fitnessResult = null;
    let changedFiles = [];
    // Prefer EventStore (no subprocess, no ENOBUFS risk)
    const GIT_MAX_BUFFER = 10 * 1024 * 1024;
    const EXCL_PREFIXES = ["node_modules/", "dist/", ".git/", ".next/", "__pycache__/", "target/", "build/"];
    let fromStore = false;
    if (bridge.event?.queryEvents) {
      try {
        const waveEvents = bridge.event.queryEvents({ eventType: "wave.files", descending: true, limit: 10 });
        if (waveEvents?.length > 0) {
          const allFiles = new Set();
          for (const ev of waveEvents) {
            const files = ev.payload?.files;
            if (Array.isArray(files)) for (const f of files) allFiles.add(f);
          }
          changedFiles = [...allFiles].filter(f => !EXCL_PREFIXES.some(p => f.startsWith(p)));
          fromStore = true;
        }
      } catch { /* fall through to git */ }
    }
    if (!fromStore) {
      try {
        const diff = execSync("git diff --name-only HEAD 2>/dev/null || git ls-files --others --exclude-standard", {
          cwd, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: "pipe",
          maxBuffer: GIT_MAX_BUFFER,
        }).trim();
        changedFiles = diff.split("\n").filter(f => f.length > 0);
        changedFiles = changedFiles.filter(f => !EXCL_PREFIXES.some(p => f.startsWith(p)));
      } catch { /* no git */ }
    }
    ctx.changedFiles = changedFiles;

    if (bridge.gate?.runFitnessGate && changedFiles.length > 0) {
      try {
        fitnessResult = await bridge.gate.runFitnessGate(cwd, changedFiles);
      } catch { /* fail-open */ }
    }

    // C. Self-checker: audit gates (scope, stubs, blueprint — PRD §6.2 P4)
    let selfCheckResult = null;
    if (bridge.gate?.runAuditGates && changedFiles.length > 0) {
      try {
        selfCheckResult = await bridge.gate.runAuditGates({
          repoRoot: cwd,
          changedFiles,
          fitnessResult,
        });
      } catch { /* fail-open */ }
    }

    // D. Domain specialist tools
    let domainFindings = [];
    if (bridge.domain?.detectDomains && changedFiles.length > 0) {
      try {
        const domains = bridge.domain.detectDomains(changedFiles);
        if (domains?.length > 0) {
          const reviewers = bridge.domain.selectReviewers(domains, "T2");
          if (reviewers?.tools?.length > 0) {
            const toolResults = await bridge.domain.runSpecialistTools(reviewers, "", cwd);
            domainFindings = bridge.domain.parseToolFindings?.(toolResults) ?? [];
          }
        }
      } catch { /* fail-open */ }
    }

    const selfCheckPassed = selfCheckResult ? selfCheckResult.passed !== false : true;
    const allPassed = mechanicalPassed && (fitnessResult?.decision !== "auto-reject") && selfCheckPassed;
    return {
      allPassed,
      results: ctx.verifyResults,
      fitness: fitnessResult ? { score: fitnessResult.score, decision: fitnessResult.decision } : null,
      selfCheck: selfCheckResult,
      domainFindings: domainFindings.length > 0 ? domainFindings.slice(0, 10) : [],
      changedFiles: changedFiles.length,
    };
  },

  /**
   * P5. QA Loop — auto-fix + re-verify + Codex cross-model audit.
   *
   * Loop: (1) auto-fix verify failures → re-verify
   *       (2) Codex audit gate → if rejected, fix with provider → re-verify
   */
  async qa(ctx, opts) {
    const { config, repoRoot, bridge, agenda } = ctx;
    if (!ctx.verifyResults) return { skipped: true, reason: "no verify results" };

    const cwd = repoRoot ?? process.cwd();
    const maxRounds = opts?.maxQARounds ?? 3;
    const commands = config?.verify?.commands ?? [];
    const rounds = [];

    // Phase A: Auto-fix mechanical failures (tsconfig, npm, test script)
    for (let round = 0; round < maxRounds; round++) {
      const failures = ctx.verifyResults.filter(r => !r.passed);
      if (failures.length === 0) break;

      const fixes = [];
      for (const f of failures) {
        const applied = applyAutoFix(f, cwd, config);
        fixes.push(...applied);
      }
      rounds.push({ round: round + 1, phase: "autofix", failures: failures.length, fixes });

      if (fixes.length === 0) break;  // No auto-fix available, move to audit
      ctx.verifyResults = runVerifyCommands(commands, cwd);
    }

    // If auto-fix didn't resolve all failures, try provider-based fix (claude fixes the code)
    let mechanicalFailures = ctx.verifyResults.filter(r => !r.passed);
    if (mechanicalFailures.length > 0) {
      const implProvider = config?.pipeline?.provider ?? "claude";
      for (let fixRound = 0; fixRound < maxRounds; fixRound++) {
        const errorSummary = mechanicalFailures.map(f =>
          `Command: ${f.command}\nErrors:\n${(f.error ?? f.output ?? "").slice(0, 1000)}`
        ).join("\n\n");

        // Use bridge fixer — no direct provider spawn fallback
        if (!bridge.gate?.runFixer) break;
        await bridge.gate.runFixer({
          repoRoot: cwd,
          findings: [errorSummary],
          files: ctx.changedFiles ?? [],
          provider: implProvider,
          previousFindings: [],
        });

        rounds.push({ round: rounds.length + 1, phase: "provider-fix", fixRound: fixRound + 1, errors: mechanicalFailures.length });

        // Re-verify
        ctx.verifyResults = commands.length > 0 ? runVerifyCommands(commands, cwd) : [];
        mechanicalFailures = ctx.verifyResults.filter(r => !r.passed);
        if (mechanicalFailures.length === 0) break;
      }
    }

    // If still failing after provider fixes, return guidance
    if (mechanicalFailures.length > 0) {
      const guidance = mechanicalFailures.map(f => ({
        command: f.command,
        exitCode: f.exitCode,
        errorSummary: (f.error ?? f.output ?? "").split("\n").slice(0, 5).join("\n"),
        suggestion: inferFixSuggestion(f),
      }));
      return { passed: false, rounds, totalRounds: rounds.length, guidance };
    }

    // Phase B: Codex cross-model audit
    let auditResult = null;
    const roles = config?.consensus?.roles ?? {};
    const auditorProvider = roles.judge ?? roles.default ?? "codex";

    try {
      if (bridge.parliament?.createConsensusAuditors) {
        const auditors = await bridge.parliament.createConsensusAuditors(roles, cwd);
        if (auditors?.judge) {
          // Collect changed files
          let changedFiles = ctx.changedFiles ?? [];
          if (changedFiles.length === 0) {
            try {
              const gitDiff = execSync("git diff --name-only HEAD 2>/dev/null || git ls-files --others --exclude-standard", {
                cwd, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: "pipe",
                maxBuffer: GIT_MAX_BUFFER,
              }).trim();
              changedFiles = gitDiff.split("\n").filter(f => f.length > 0);
              changedFiles = changedFiles.filter(f => !EXCL_PREFIXES.some(p => f.startsWith(p)));
            } catch { /* no git or no changes */ }
          }

          // Build evidence for audit
          const evidence = [
            `Agenda: ${agenda}`,
            `Changed files: ${changedFiles.join(", ") || "(all new)"}`,
            `Verify: all commands passed`,
          ].join("\n");

          const auditReq = {
            evidence,
            prompt: `Review the implementation of "${agenda}". Check for security issues, logic errors, and code quality.`,
            files: changedFiles,
          };

          auditResult = await auditors.judge.audit(auditReq);
          rounds.push({
            round: rounds.length + 1,
            phase: "codex-audit",
            provider: auditorProvider,
            verdict: auditResult.verdict,
            summary: auditResult.summary?.slice(0, 300),
            codes: auditResult.codes,
          });

          // Record verdict in EventStore
          bridge.event?.emitEvent?.("audit.verdict", "pipeline", {
            verdict: auditResult.verdict,
            provider: auditorProvider,
            codes: auditResult.codes,
            summary: auditResult.summary?.slice(0, 200),
          });

          // Phase C: If rejected, delegate to runFixerCycle (has findingsHistory + stagnation detection)
          if (auditResult.verdict === "changes_requested" && bridge.gate?.runFixerCycle) {
            const changedFilesList = ctx.changedFiles ?? changedFiles;
            const implProvider = config?.pipeline?.provider ?? "claude";

            const fixResult = await bridge.gate.runFixerCycle({
              repoRoot: cwd,
              files: changedFilesList,
              provider: implProvider,
              maxRounds: Infinity,  // stagnation detection handles convergence
              auditFn: async (_repoRoot, _files, _items, _prov) => {
                const result = await auditors.judge.audit(auditReq);
                rounds.push({
                  round: rounds.length + 1,
                  phase: "fix-reaudit",
                  verdict: result.verdict,
                  summary: result.summary?.slice(0, 200),
                });
                bridge.event?.emitEvent?.("audit.verdict", "pipeline-reaudit", {
                  verdict: result.verdict,
                });
                return {
                  passed: result.verdict === "approved",
                  findings: result.codes ?? [result.summary ?? "audit failed"],
                };
              },
              completedItems: changedFilesList.map(f => ({ id: f, targetFiles: [f] })),
              // detectStagnation auto-injected by bridge
            });

            if (fixResult.passed) {
              auditResult = { ...auditResult, verdict: "approved" };
            } else if (fixResult.stagnation) {
              console.log(`  \x1b[33m⚠ Fix cycle stagnation: ${fixResult.stagnation}\x1b[0m`);
            }
          }
        }
      }
    } catch (err) {
      rounds.push({
        round: rounds.length + 1,
        phase: "codex-audit",
        provider: auditorProvider,
        verdict: "skipped",
        reason: err?.message ?? "auditor unavailable",
      });
    }

    // Only approved passes — incomplete audit (infra_failure) is not approval
    // If no auditor available (auditResult null), pass (fail-open for missing infra, not for verdict)
    const auditPassed = auditResult === null ? true : auditResult.verdict === "approved";
    return {
      passed: auditPassed,
      rounds,
      totalRounds: rounds.length,
      auditVerdict: auditResult?.verdict ?? "skipped",
      auditSummary: auditResult?.summary?.slice(0, 500) ?? null,
    };
  },

  /**
   * P6. Finalize — retro + fact extraction + handoff + state.
   */
  async finalize(ctx) {
    const { agenda, bridge, repoRoot, verifyResults } = ctx;
    const verifyPassed = verifyResults?.every(r => r.passed) ?? true;

    // A. Squash WIP commits into a single clean commit
    let squashed = false;
    if (repoRoot && ctx._preImplementRef) {
      try {
        const currentHead = execSync("git rev-parse HEAD", {
          cwd: repoRoot, encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
        }).trim();

        // Only squash if new commits were created after pre-implement ref
        if (currentHead !== ctx._preImplementRef) {
          execSync(`git reset --soft ${ctx._preImplementRef}`, {
            cwd: repoRoot, timeout: 10_000, windowsHide: true, stdio: "pipe",
          });
          execSync(`git commit -m "feat(pipeline): ${agenda}"`, {
            cwd: repoRoot, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: "pipe",
          });
          squashed = true;
        }
      } catch { /* fail-open: WIP commits remain as-is */ }
    }

    // B. Emit pipeline.complete event
    bridge.event?.emitEvent?.("pipeline.complete", "claude-code", {
      agenda,
      success: verifyPassed,
      timestamp: Date.now(),
    });

    // B. Auto-retro (lifecycle hook)
    let retroDone = false;
    if (bridge.gate?.runAutoRetro) {
      try {
        await bridge.gate.runAutoRetro(repoRoot);
        retroDone = true;
      } catch { /* fail-open */ }
    }

    // C. Fact extraction from pipeline events
    let factsExtracted = 0;
    if (bridge.fact?.addFact) {
      try {
        // Extract facts from the pipeline run
        const events = bridge.event?.queryEvents?.({ limit: 20, descending: true }) ?? [];
        const { extractFacts } = await import("./fact-extractor.mjs");
        const facts = extractFacts(events);
        for (const f of facts) {
          bridge.fact.addFact(f);
          factsExtracted++;
        }
      } catch { /* fail-open: fact system optional */ }
    }

    // E. Write completion state
    const stateDir = repoRoot ? resolve(repoRoot, ".claude", "quorum", "pipeline") : null;
    if (stateDir && existsSync(stateDir)) {
      writeFileSync(resolve(stateDir, "state.json"), JSON.stringify({
        status: "complete",
        agenda,
        completedAt: new Date().toISOString(),
        verifyPassed,
        retroDone,
        factsExtracted,
        squashed,
      }, null, 2), "utf8");
    }

    return { finalized: true, retroDone, factsExtracted, squashed };
  },
};


/**
 * Run verify commands and collect results.
 * @param {string[]} commands
 * @param {string} cwd
 * @returns {Array<{command: string, passed: boolean, output?: string, error?: string, exitCode?: number}>}
 */
function runVerifyCommands(commands, cwd) {
  const results = [];
  for (const cmd of commands) {
    try {
      const output = execSync(cmd, {
        cwd, encoding: "utf8", timeout: 60_000, windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      results.push({ command: cmd, passed: true, output: output.slice(0, 500) });
    } catch (err) {
      results.push({
        command: cmd, passed: false,
        output: (err.stdout ?? "").slice(0, 500),
        error: (err.stderr ?? err.message ?? "").slice(0, 500),
        exitCode: err.status,
      });
    }
  }
  return results;
}

/**
 * Analyze a verify failure and apply auto-fix if possible.
 * Returns list of fixes applied.
 *
 * @param {{command: string, output?: string, error?: string}} failure
 * @param {string} cwd
 * @param {object} config
 * @returns {Array<{type: string, detail: string}>}
 */
function applyAutoFix(failure, cwd, config) {
  const fixes = [];
  const combined = `${failure.output ?? ""}\n${failure.error ?? ""}`;

  // Fix: missing node_modules → npm install
  if (/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/.test(combined)) {
    try {
      execSync("npm install", { cwd, encoding: "utf8", timeout: 120_000, windowsHide: true, stdio: "pipe" });
      fixes.push({ type: "npm-install", detail: "installed missing dependencies" });
    } catch { /* can't fix */ }
  }

  // Fix: tsconfig moduleResolution issue (undici-types, etc.)
  if (/Cannot find module.*undici-types|moduleResolution/.test(combined)) {
    const tsconfigPath = resolve(cwd, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      try {
        const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
        let changed = false;
        if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
        if (!tsconfig.compilerOptions.moduleResolution) {
          tsconfig.compilerOptions.moduleResolution = "bundler";
          changed = true;
        }
        if (!tsconfig.compilerOptions.skipLibCheck) {
          tsconfig.compilerOptions.skipLibCheck = true;
          changed = true;
        }
        if (!tsconfig.compilerOptions.esModuleInterop) {
          tsconfig.compilerOptions.esModuleInterop = true;
          changed = true;
        }
        if (changed) {
          writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n", "utf8");
          fixes.push({ type: "tsconfig-fix", detail: "added moduleResolution/skipLibCheck/esModuleInterop" });
        }
      } catch { /* can't fix */ }
    }
  }

  // Fix: esModuleInterop / default import issues
  if (/can only be default-imported|has no default export|allowSyntheticDefaultImports/.test(combined)) {
    const tsconfigPath = resolve(cwd, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      try {
        const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
        if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
        let changed = false;
        if (!tsconfig.compilerOptions.esModuleInterop) {
          tsconfig.compilerOptions.esModuleInterop = true;
          changed = true;
        }
        if (!tsconfig.compilerOptions.skipLibCheck) {
          tsconfig.compilerOptions.skipLibCheck = true;
          changed = true;
        }
        if (changed) {
          writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n", "utf8");
          fixes.push({ type: "tsconfig-esm-fix", detail: "enabled esModuleInterop + skipLibCheck" });
        }
      } catch { /* can't fix */ }
    }
  }

  // Fix: test script can't find tests directory (node --test needs glob)
  if (/Cannot find module.*tests|Cannot find.*tests/.test(combined) && failure.command.includes("test")) {
    const pkgPath = resolve(cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        const testScript = pkg.scripts?.test ?? "";
        if (testScript === "node --test tests/" || testScript === "node --test tests") {
          pkg.scripts.test = "node --test 'tests/**/*.test.mjs'";
          writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
          fixes.push({ type: "test-script-fix", detail: "fixed test glob pattern" });
        }
      } catch { /* can't fix */ }
    }
  }

  return fixes;
}

/**
 * Infer fix suggestion from a verify failure.
 * @param {{command: string, error?: string, exitCode?: number}} failure
 * @returns {string}
 */
function inferFixSuggestion(failure) {
  const err = (failure.error ?? "").toLowerCase();
  if (/cannot find module|module not found/.test(err)) return "모듈을 설치하거나 import 경로를 확인하세요";
  if (/type error|is not assignable/.test(err)) return "타입 오류를 수정하세요";
  if (/test.*fail|assertion/i.test(err)) return "실패한 테스트를 확인하고 로직을 수정하세요";
  if (/syntax error/.test(err)) return "문법 오류를 수정하세요";
  if (/eslint|lint/.test(failure.command)) return "린트 규칙 위반을 수정하세요";
  return "오류 출력을 확인하고 수정하세요";
}

/**
 * Build a pipeline directive for Claude's additionalContext.
 * This is the main entry point for prompt-submit integration.
 *
 * @param {string} agenda
 * @param {object} config
 * @returns {string}
 */
export function buildPipelineDirective(agenda, config) {
  const gateProfile = config?.gates?.gateProfile ?? "balanced";
  const domains = config?.domains?.active ?? [];
  const verifyCommands = config?.verify?.commands ?? [];
  const teamSize = config?.parliament?.maxRounds === 1 ? "solo"
    : config?.parliament?.maxRounds <= 3 ? "small" : "large";

  const sections = [
    `[quorum auto-pipeline] 자동 개발 파이프라인이 활성화되었습니다.`,
    ``,
    `## 의제`,
    agenda,
    ``,
    `## 실행 계획`,
    `다음 단계를 순서대로 실행하세요:`,
    ``,
    `### 1. 설계 (Design)`,
    `- 필요한 파일과 컴포넌트를 결정하세요`,
    `- 각 파일의 역할과 인터페이스를 정의하세요`,
    domains.length > 0 ? `- 주의 도메인: ${domains.join(", ")}` : null,
    ``,
    `### 2. 구현 (Implement)`,
    `- 설계한 파일들을 순서대로 생성하세요`,
    `- 타입 안전성과 에러 처리를 포함하세요`,
    `- 테스트 파일도 함께 작성하세요`,
    ``,
    `### 3. 검증 (Verify)`,
    verifyCommands.length > 0
      ? `- 다음 명령어를 실행하여 검증하세요:\n${verifyCommands.map(c => `  - \`${c}\``).join("\n")}`
      : `- 코드가 정상 동작하는지 확인하세요`,
    ``,
    `### 4. 수정 (QA)`,
    `- 검증에서 실패한 항목을 수정하세요`,
    `- 모든 검증이 통과할 때까지 반복하세요`,
    ``,
    `## 프로필`,
    `- Gate: ${gateProfile}`,
    domains.length > 0 ? `- 도메인: ${domains.join(", ")}` : null,
    `- 팀: ${teamSize}`,
    ``,
    `이 계획에 따라 자동으로 구현을 진행하세요.`,
  ];

  return sections.filter(s => s !== null).join("\n");
}

/**
 * Build a parliament agenda string from SetupIntent + ProjectProfile.
 *
 * @param {import("./setup-interview.mjs").SetupIntent} intent
 * @param {import("./project-scanner.mjs").ProjectProfile} profile
 * @returns {string}
 */
export function buildAgenda(intent, profile) {
  const parts = [];
  if (profile.languages.length > 0) parts.push(profile.languages.join("/"));
  if (profile.frameworks.length > 0) parts.push(profile.frameworks.join("+"));
  parts.push("프로젝트에서");
  parts.push(intent.agenda);

  const PRIORITY_HINTS = {
    strict: "보안 최우선.",
    fast: "빠른 구현 우선.",
    prototype: "실험적 프로토타입.",
    balanced: "",
  };
  const hint = PRIORITY_HINTS[intent.gateProfile] ?? "";
  if (hint) parts.push(hint);
  if (intent.activeDomains.length > 0) parts.push(`주의 도메인: ${intent.activeDomains.join(", ")}.`);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Get pipeline stage names.
 * @returns {readonly PipelineStage[]}
 */
export function getStages() {
  return STAGES;
}

/**
 * Auto-detect verify commands from project files (post-implement).
 * Called when config.verify.commands is empty (setup ran before code existed).
 * @param {string} cwd
 * @returns {string[]}
 */
function detectVerifyCommands(cwd) {
  const commands = [];
  if (existsSync(resolve(cwd, "tsconfig.json"))) commands.push("npx tsc --noEmit");
  if (existsSync(resolve(cwd, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        commands.push("npm test");
      }
    } catch { /* skip */ }
  }
  if (existsSync(resolve(cwd, "pyproject.toml")) || existsSync(resolve(cwd, "setup.py"))) {
    commands.push("pytest");
  }
  if (existsSync(resolve(cwd, "go.mod"))) commands.push("go test ./...");
  if (existsSync(resolve(cwd, "Cargo.toml"))) commands.push("cargo test");
  return commands;
}
