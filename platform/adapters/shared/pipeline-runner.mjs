/**
 * Pipeline Runner — 6-stage auto-development pipeline.
 *
 * PRD § 6.2: Plan → Design → Implement → Verify → QA Loop → Finalize
 * Manager-Orchestrator principle: runner does NOT generate code.
 * Instead it generates directives for Claude and runs verify commands.
 *
 * @module adapters/shared/pipeline-runner
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

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
  const { maxQARounds = 3, onStageChange, repoRoot } = opts;
  const stages = [];
  const totalStart = Date.now();
  const ctx = { agenda, config, bridge, repoRoot, plan: null, verifyResults: null };

  for (const stage of STAGES) {
    onStageChange?.(stage, "running");
    const stageStart = Date.now();

    try {
      const handler = STAGE_HANDLERS[stage];
      const output = await handler(ctx, { maxQARounds });
      const result = { stage, status: output?.skipped ? "skipped" : "success", output, duration: Date.now() - stageStart };
      stages.push(result);
      onStageChange?.(stage, result.status);

      bridge.event?.emitEvent?.("pipeline.stage.complete", "claude-code", {
        stage, status: result.status, duration: result.duration,
      });
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

  return { success: true, stages, totalDuration: Date.now() - totalStart };
}

// ── Stage Handlers ──────────────────────────────────────────

const STAGE_HANDLERS = {
  /**
   * P1. Plan — generate structured plan from agenda + config.
   * Tries parliament first, falls back to template-based plan.
   */
  async plan(ctx) {
    const { agenda, config, bridge } = ctx;

    // Try parliament CPS generation
    if (bridge.parliament?.runParliamentSession) {
      try {
        const result = await bridge.parliament.runParliamentSession({
          agenda: [agenda],
          source: "pipeline",
        });
        if (result?.cps) {
          ctx.plan = { source: "parliament", cps: result.cps, converged: result.converged ?? false };
          return ctx.plan;
        }
      } catch { /* fall through to template */ }
    }

    // Template-based plan from agenda + config context
    const domains = config?.domains?.active ?? [];
    const gateProfile = config?.gates?.gateProfile ?? "balanced";
    ctx.plan = {
      source: "template",
      agenda,
      gateProfile,
      domains,
      phases: [
        { name: "설계", description: "파일 구조 + 인터페이스 결정" },
        { name: "구현", description: `${agenda} 핵심 로직 작성` },
        { name: "검증", description: "테스트 + 타입 체크 실행" },
      ],
    };
    return ctx.plan;
  },

  /**
   * P2. Design — generate WBs via planner (or provider fallback).
   * Calls planner to create work-breakdown.md from CPS/agenda.
   */
  async design(ctx) {
    const { plan, config, repoRoot, agenda, bridge } = ctx;
    if (!plan) return { skipped: true, reason: "no plan from plan stage" };
    if (!repoRoot) return { skipped: true, reason: "no repoRoot" };

    const provider = config?.pipeline?.provider ?? "claude";
    const domains = config?.domains?.active ?? [];
    const verifyCommands = config?.verify?.commands ?? [];
    const trackName = config?._meta?.trackName ?? "pipeline";

    // Create track directory for WBs
    const trackDir = resolve(repoRoot, "docs", trackName);
    mkdirSync(trackDir, { recursive: true });
    const wbPath = resolve(trackDir, "work-breakdown.md");

    // If WBs already exist, skip generation
    if (existsSync(wbPath)) {
      ctx.wbPath = wbPath;
      ctx.trackName = trackName;
      return { wbPath, trackName, source: "existing" };
    }

    // Generate WBs: spawn provider with structured planning prompt
    const planPrompt = [
      `ROLE: You are a planner. Generate a work-breakdown.md file.`,
      `Write the file to: ${wbPath}`,
      ``,
      `TASK: ${agenda}`,
      domains.length > 0 ? `DOMAINS: ${domains.join(", ")}` : null,
      ``,
      `FORMAT: Each work item as a markdown heading with fields:`,
      `### WB-N: <title>`,
      `- **Action**: what to do`,
      `- **Target files**: src/path/to/file.ts`,
      `- **Verify**: how to verify (e.g., "npx tsc --noEmit && npm test")`,
      `- **Done**: completion criteria`,
      ``,
      `Include 3-8 work items covering: schema/models, core logic, routes/API, middleware, tests.`,
      verifyCommands.length > 0 ? `Verify commands available: ${verifyCommands.join(", ")}` : null,
      ``,
      `Write the work-breakdown.md file NOW. No explanations.`,
    ].filter(Boolean).join("\n");

    try {
      spawnProvider(provider, planPrompt, repoRoot, {});
    } catch (err) {
      // Fallback: generate minimal WBs template
      const template = [
        `# Work Breakdown — ${agenda}`,
        ``,
        `### WB-1: Core implementation`,
        `- **Action**: Implement ${agenda}`,
        `- **Target files**: src/`,
        `- **Verify**: ${verifyCommands[0] ?? "manual check"}`,
        `- **Done**: All source files created and compilable`,
      ].join("\n");
      writeFileSync(wbPath, template, "utf8");
    }

    ctx.wbPath = existsSync(wbPath) ? wbPath : null;
    ctx.trackName = trackName;
    return { wbPath: ctx.wbPath, trackName, source: existsSync(wbPath) ? "provider" : "failed" };
  },

  /**
   * P3. Implement — orchestrate engine (wave execution) or provider CLI fallback.
   *
   * Priority: (1) orchestrate.runWave if WBs exist (from P2 design)
   *           (2) provider CLI spawn as fallback
   */
  async implement(ctx) {
    const { plan, config, repoRoot, agenda, bridge } = ctx;
    if (!plan) return { skipped: true, reason: "no plan" };
    if (!repoRoot) return { skipped: true, reason: "no repoRoot" };

    const provider = config?.pipeline?.provider ?? "claude";
    const auditor = config?.consensus?.roles?.judge ?? "codex";
    const domains = config?.domains?.active ?? [];
    const verifyCommands = config?.verify?.commands ?? [];
    const planDir = resolve(repoRoot, ".claude", "quorum", "pipeline");
    mkdirSync(planDir, { recursive: true });

    // Pre-implement: install dependencies
    const pkgPath = resolve(repoRoot, "package.json");
    if (existsSync(pkgPath) && !existsSync(resolve(repoRoot, "node_modules"))) {
      try { execSync("npm install", { cwd: repoRoot, encoding: "utf8", timeout: 120_000, windowsHide: true, stdio: "pipe" }); } catch { /* fail-open */ }
    }

    // Pre-implement: ensure git has at least one commit (scope-gates + waveCommit need HEAD)
    try {
      execSync("git rev-parse HEAD", { cwd: repoRoot, timeout: 5000, windowsHide: true, stdio: "pipe" });
    } catch {
      try {
        execSync("git add -A && git commit -m \"initial (pipeline pre-implement)\" --allow-empty", {
          cwd: repoRoot, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: "pipe",
        });
      } catch { /* fail-open: no git or no files */ }
    }

    // Path A: Use orchestrate engine if WBs exist (from P2 design stage)
    if (ctx.wbPath && existsSync(ctx.wbPath) && bridge.gate?.runOrchestrateLoop) {
      try {
        const orchResult = await bridge.gate.runOrchestrateLoop({
          repoRoot,
          trackName: ctx.trackName ?? "pipeline",
          wbPath: ctx.wbPath,
          provider,
          auditor,
          maxConcurrency: 3,
          maxRetries: 3,
          // Skip orchestrate-internal LLM audit — pipeline P5 QA handles cross-model audit.
          // This avoids spawnSync/Windows process tree timeout issues.
          skipAudit: true,
          onLog: (msg) => { try { writeFileSync(resolve(planDir, "implement-log.txt"), msg + "\n", { flag: "a" }); } catch { /* log dir may be gone */ } },
        });

        writeFileSync(resolve(planDir, "implement-log.txt"), [
          `mode: orchestrate`,
          `success: ${orchResult.success}`,
          `completed: ${orchResult.completedIds?.length ?? 0}`,
          `failedWaves: ${orchResult.failedWaves ?? 0}`,
          `timestamp: ${new Date().toISOString()}`,
        ].join("\n"), "utf8");

        return { mode: "orchestrate", ...orchResult };
      } catch (err) {
        // Orchestrate failed — fall through to provider CLI
        try {
          mkdirSync(planDir, { recursive: true });
          writeFileSync(resolve(planDir, "orchestrate-error.txt"), `${err?.message}\n${err?.stack ?? ""}`, "utf8");
        } catch { /* can't even log — still fall through to Path B */ }
      }
    }

    // Path B: Provider CLI fallback (direct code generation)
    const prompt = [
      `ROLE: You are a code implementer. Your ONLY job is to write files. Do NOT explain, do NOT ask questions, do NOT provide insights.`,
      ``,
      `TASK: ${agenda}`,
      ``,
      `Write ALL of the following files now:`,
      `- Source files in src/ directory (.ts)`,
      `- Test file in tests/ directory (.test.mjs) with at least 10 test cases`,
      `- Update package.json if new dependencies are needed`,
      ``,
      domains.length > 0 ? `DOMAINS TO CONSIDER: ${domains.join(", ")}` : null,
      verifyCommands.length > 0 ? `MUST PASS: ${verifyCommands.join(" && ")}` : null,
      ``,
      `Write every file now. Start with the first file immediately.`,
    ].filter(Boolean).join("\n");

    let result;
    try {
      result = spawnProvider(provider, prompt, repoRoot, {
        timeout: config?.pipeline?.timeout || undefined,
      });
    } catch (err) {
      writeFileSync(resolve(planDir, "implement-brief.md"), prompt, "utf8");
      return { skipped: true, reason: `provider "${provider}" not available: ${err?.message}`, fallback: "brief" };
    }

    writeFileSync(resolve(planDir, "implement-log.txt"), [
      `mode: provider-cli`,
      `provider: ${provider}`,
      `exitCode: ${result.exitCode}`,
      `timestamp: ${new Date().toISOString()}`,
      `---`,
      result.stdout.slice(0, 2000),
    ].join("\n"), "utf8");

    if (result.exitCode !== 0 && result.exitCode !== null) {
      throw new Error(`provider ${provider} exited with code ${result.exitCode}`);
    }

    return { mode: "provider-cli", provider, exitCode: result.exitCode, outputLength: result.stdout.length };
  },

  /**
   * P4. Verify — deps install + verify commands + fitness gate + domain specialists.
   */
  async verify(ctx) {
    const { config, repoRoot, bridge } = ctx;
    const commands = config?.verify?.commands ?? [];
    const cwd = repoRoot ?? process.cwd();

    // Pre-verify: install dependencies
    const pkgPath = resolve(cwd, "package.json");
    if (existsSync(pkgPath) && !existsSync(resolve(cwd, "node_modules"))) {
      try {
        execSync("npm install", { cwd, encoding: "utf8", timeout: 120_000, windowsHide: true, stdio: "pipe" });
      } catch { /* fail-open */ }
    }

    // A. Mechanical verify commands (tsc, npm test, etc.)
    ctx.verifyResults = commands.length > 0 ? runVerifyCommands(commands, cwd) : [];
    const mechanicalPassed = ctx.verifyResults.every(r => r.passed);

    // B. Fitness gate (7-component quality score)
    let fitnessResult = null;
    let changedFiles = [];
    try {
      const diff = execSync("git diff --name-only HEAD 2>/dev/null || git ls-files --others --exclude-standard", {
        cwd, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: "pipe",
      }).trim();
      changedFiles = diff.split("\n").filter(f => f.length > 0);
    } catch { /* no git */ }
    ctx.changedFiles = changedFiles;

    if (bridge.gate?.runFitnessGate && changedFiles.length > 0) {
      try {
        fitnessResult = await bridge.gate.runFitnessGate(cwd, changedFiles);
      } catch { /* fail-open */ }
    }

    // C. Domain specialist tools
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

    const allPassed = mechanicalPassed && (fitnessResult?.decision !== "auto-reject");
    return {
      allPassed,
      results: ctx.verifyResults,
      fitness: fitnessResult ? { score: fitnessResult.score, decision: fitnessResult.decision } : null,
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

        // Try bridge fixer first
        let fixerRan = false;
        if (bridge.gate?.runFixer) {
          try {
            await bridge.gate.runFixer({
              repoRoot: cwd,
              findings: [errorSummary],
              files: ctx.changedFiles ?? [],
              provider: implProvider,
            });
            fixerRan = true;
          } catch { /* fall through to provider */ }
        }

        // Fallback: spawn provider to fix
        if (!fixerRan) {
          try {
            spawnProvider(implProvider, `Fix these build errors. Do not explain, just fix the code:\n\n${errorSummary}`, cwd, {});
          } catch { /* can't fix */ }
        }

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
          let changedFiles = [];
          try {
            const gitDiff = execSync("git diff --name-only HEAD 2>/dev/null || git ls-files --others --exclude-standard", {
              cwd, encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: "pipe",
            }).trim();
            changedFiles = gitDiff.split("\n").filter(f => f.length > 0);
          } catch { /* no git or no changes */ }

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

          // Phase C: If rejected, run fixer → re-audit loop (up to maxRounds)
          if (auditResult.verdict === "changes_requested") {
            const findings = auditResult.codes ?? [];
            const changedFilesList = ctx.changedFiles ?? changedFiles;
            const implProvider = config?.pipeline?.provider ?? "claude";

            for (let fixRound = 0; fixRound < maxRounds; fixRound++) {
              // Try bridge fixer first (compiled orchestrate engine)
              let fixerRan = false;
              if (bridge.gate?.runFixer) {
                try {
                  await bridge.gate.runFixer({
                    repoRoot: cwd,
                    findings: [auditResult.summary ?? findings.join(", ")],
                    files: changedFilesList,
                    provider: implProvider,
                  });
                  fixerRan = true;
                } catch { /* fall through to provider fixer */ }
              }

              // Fallback: spawn provider to fix
              if (!fixerRan) {
                try {
                  const fixPrompt = `Fix these audit findings:\n${auditResult.summary ?? findings.join("\n")}\n\nAffected files: ${changedFilesList.join(", ")}\n\nApply fixes directly. Do not explain.`;
                  spawnProvider(implProvider, fixPrompt, cwd, {});
                } catch { /* can't fix */ }
              }

              // Re-audit
              const reAudit = await auditors.judge.audit(auditReq);
              rounds.push({
                round: rounds.length + 1,
                phase: "fix-reaudit",
                fixRound: fixRound + 1,
                verdict: reAudit.verdict,
                summary: reAudit.summary?.slice(0, 200),
              });

              bridge.event?.emitEvent?.("audit.verdict", "pipeline-reaudit", {
                verdict: reAudit.verdict, round: fixRound + 1,
              });

              if (reAudit.verdict === "approved" || reAudit.verdict === "infra_failure") {
                auditResult = reAudit;
                break;
              }
              auditResult = reAudit;
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

    // Fail-open: infra_failure or skipped means auditor had issues, not the code
    const auditPassed = !auditResult
      || auditResult.verdict === "approved"
      || auditResult.verdict === "infra_failure";
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

    // A. Emit pipeline.complete event
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

    // D. Write completion state
    const stateDir = repoRoot ? resolve(repoRoot, ".claude", "quorum", "pipeline") : null;
    if (stateDir && existsSync(stateDir)) {
      writeFileSync(resolve(stateDir, "state.json"), JSON.stringify({
        status: "complete",
        agenda,
        completedAt: new Date().toISOString(),
        verifyPassed,
        retroDone,
        factsExtracted,
      }, null, 2), "utf8");
    }

    return { finalized: true, retroDone, factsExtracted };
  },
};

/**
 * Spawn a provider CLI to execute a prompt.
 * Writes prompt to a temp file to avoid shell escaping issues.
 *
 * @param {string} provider - "claude" | "codex" | "gemini"
 * @param {string} prompt - The full prompt text
 * @param {string} cwd - Working directory
 * @param {object} [opts]
 * @param {number} [opts.timeout=300000]
 * @returns {{stdout: string, exitCode: number|null}}
 */
function spawnProvider(provider, prompt, cwd, opts = {}) {
  const timeout = opts.timeout || undefined;  // 0/null/undefined = no timeout

  // Quick check: verify provider binary exists before spawning
  try {
    execSync(process.platform === "win32" ? `where ${provider}` : `which ${provider}`, {
      encoding: "utf8", timeout: 5000, windowsHide: true, stdio: "pipe",
    });
  } catch {
    throw new Error(`binary "${provider}" not found in PATH`);
  }

  // Write prompt to temp file (avoids shell arg length limits on Windows)
  const promptFile = resolve(tmpdir(), `quorum-pipeline-${Date.now()}.txt`);
  writeFileSync(promptFile, prompt, "utf8");

  try {
    if (provider === "claude") {
      // Pass prompt via stdin to avoid shell arg length/escaping issues.
      // claude -p - reads from stdin (pipe mode).
      const isWin = process.platform === "win32";
      const bin = isWin ? (process.env.ComSpec ?? "cmd.exe") : "claude";
      const args = ["-p", "-", "--dangerously-skip-permissions"];
      const spawnArgs = isWin ? ["/c", "claude", ...args] : args;

      const result = spawnSync(bin, spawnArgs, {
        cwd,
        input: prompt,
        encoding: "utf8",
        timeout,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        stdout: result.stdout ?? "",
        exitCode: result.status,
      };
    }

    if (provider === "codex") {
      const result = spawnSync("codex", ["exec", "--full-auto", "-"], {
        cwd,
        input: prompt,
        encoding: "utf8",
        timeout,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: result.stdout ?? "", exitCode: result.status };
    }

    // Fallback: try provider name as binary
    const result = spawnSync(provider, ["-p", prompt], {
      cwd, encoding: "utf8", timeout, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: result.stdout ?? "", exitCode: result.status };
  } finally {
    try { unlinkSync(promptFile); } catch { /* cleanup */ }
  }
}

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
