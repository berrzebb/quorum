/**
 * Planner session orchestration — the high-level flow that ties
 * CPS loading → mode determination → prompt building → provider execution.
 *
 * Combines all extracted planning modules into a single session controller.
 */

import { resolve } from "node:path";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { loadCPS, loadPlannerProtocol } from "./cps-loader.js";
import { buildPlannerSystemPrompt, buildSocraticPrompt, buildInlineAutoPrompt, derivePrefix, buildPhasedPrompt, type PlannerPhase } from "./planner-prompts.js";
import { determinePlannerMode } from "./planner-mode.js";
import { runProviderCLI } from "../core/provider-cli.js";
import { detectMuxBackend } from "../core/mux-backend.js";
import { spawnMuxSession, pollMuxCompletion, cleanupMuxSession } from "../core/mux-session.js";

/** Options for running a planner session. */
export interface PlannerSessionOptions {
  repoRoot: string;
  trackName: string;
  provider: string;
  useMux: boolean;
  useAuto: boolean;
}

/** Result from a planner session. */
export interface PlannerSessionResult {
  /** Whether the session ran in auto mode. */
  autoMode: boolean;
  /** Provider used. */
  provider: string;
  /** Track name. */
  trackName: string;
  /** Slugified track name (used for file paths). */
  trackSlug: string;
}

/**
 * Run the planner session: load CPS, build prompts, execute via direct or mux.
 *
 * This is the core orchestration logic extracted from planner.ts.
 * The caller handles CLI output formatting and post-session checks.
 */
export async function runPlannerSession(opts: PlannerSessionOptions): Promise<PlannerSessionResult> {
  const { repoRoot, trackName, provider, useMux, useAuto } = opts;

  // Load CPS
  const cps = loadCPS(repoRoot);
  const cpsContent = cps?.raw ?? "";
  if (cps) console.log(`  \x1b[32m✓\x1b[0m CPS loaded`);

  // Load planner protocol
  const protocol = loadPlannerProtocol(repoRoot);

  const planDir = resolve(repoRoot, "docs", "plan");
  const trackSlug = slugify(trackName);
  const prefix = derivePrefix(trackName);
  const promptOpts = { trackName, cpsContent, protocol, planDir, prefix, trackSlug };
  const systemPrompt = buildPlannerSystemPrompt(promptOpts);
  const socraticPrompt = buildSocraticPrompt({ trackName, hasCPS: !!cpsContent });
  const autoPrompt = buildInlineAutoPrompt(promptOpts);

  // Determine mode
  const autoMode = determinePlannerMode({
    isAuto: useAuto, isMux: useMux, hasCPS: !!cpsContent, isTTY: !!process.stdin.isTTY,
  }) === "auto";

  console.log(`  Track: ${trackName}, Provider: ${provider}, CPS: ${cpsContent ? "yes" : "Socratic"}${useMux ? ", Mux: on" : ""}${autoMode ? ", Auto: on" : ""}\n`);

  // Build CLI args
  const initialPrompt = autoMode ? autoPrompt : socraticPrompt;
  const { args: cliArgs, tempFiles } = buildCLIArgs(provider, systemPrompt, initialPrompt, autoMode, repoRoot);

  // Execute — planner needs long timeout (8 files × ~2min each ≈ 16min)
  const plannerTimeout = 20 * 60_000; // 20 minutes

  try {
    if (useMux) {
      if (provider === "claude") {
        cliArgs.push("--dangerously-skip-permissions", "--output-format", "stream-json");
        // Mux path needs -p (non-interactive) for pollMuxCompletion to detect completion.
        // buildCLIArgs in non-auto mode uses positional arg — convert to -p.
        if (!autoMode && !cliArgs.includes("-p")) {
          const positionalIdx = cliArgs.findIndex((a, i) => !a.startsWith("-") && (i === 0 || !cliArgs[i - 1]!.startsWith("--")));
          if (positionalIdx >= 0) {
            const prompt = cliArgs.splice(positionalIdx, 1)[0]!;
            cliArgs.unshift("-p", prompt);
          }
        }
      }
      await executeMux(repoRoot, provider, cliArgs, trackName, autoMode, plannerTimeout);
    } else {
      await runProviderCLI({ provider, args: cliArgs, cwd: repoRoot, stdio: "inherit", timeout: plannerTimeout });
    }
  } finally {
    // Clean up temp files
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }

  return { autoMode, provider, trackName, trackSlug };
}

// ── Parallel Planner (v0.6.5: split into 4 sub-agents) ──────

/** Options for running a parallel planner session. */
export interface ParallelPlannerOptions {
  repoRoot: string;
  trackName: string;
  provider: string;
  /** Pipeline agenda (e.g. "Build Task API"). Injected into planner system prompt. */
  agenda?: string;
  /** CPS from parliament convergence. */
  cps?: string | null;
  /** Parliament verdict (when not fully converged). */
  verdict?: string | null;
  /** Timeout per sub-agent in ms. Default: 10 minutes. */
  subAgentTimeout?: number;
  /** Use mux for sub-agent spawn (enables daemon capture). Default: true in auto mode. */
  useMux?: boolean;
}

/**
 * Run planner as 4 parallel sub-agents:
 *   1. PRD agent → PRD.md
 *   2. Design agent → spec + blueprint + domain-model
 *   3. Test agent → test-strategy
 *   4. WB agent → work-breakdown + execution-order + work-catalog
 *
 * Agents 1-3 start immediately in parallel.
 * Agent 4 starts in parallel but reads outputs from 1-3 as they appear.
 * All agents share the same working directory — file system is the communication channel.
 */
export async function runParallelPlannerSession(opts: ParallelPlannerOptions): Promise<PlannerSessionResult> {
  const { repoRoot, trackName, provider } = opts;
  const timeout = opts.subAgentTimeout ?? 10 * 60_000;

  // CPS priority: opts.cps (from parliament) > file on disk > empty
  const fileCps = loadCPS(repoRoot);
  const cpsContent = opts.cps ?? fileCps?.raw ?? "";
  const agendaContext = opts.agenda ? `\n\n## Agenda\n\n${opts.agenda}` : "";
  const verdictContext = opts.verdict ? `\n\n## Parliament Verdict\n\n${opts.verdict}` : "";
  const protocol = loadPlannerProtocol(repoRoot);

  const planDir = resolve(repoRoot, "docs", "plan");
  const trackSlug = slugify(trackName);
  const prefix = derivePrefix(trackName);
  const fullCpsContent = [cpsContent, agendaContext, verdictContext].filter(Boolean).join("");
  const promptOpts = { trackName, cpsContent: fullCpsContent, protocol, planDir, prefix, trackSlug };
  const systemPrompt = buildPlannerSystemPrompt(promptOpts);

  console.log(`  Track: ${trackName}, Provider: ${provider}, Mode: parallel (3 sub-agents)\n`);

  // Pre-create target directory so agents use it (not stale dirs from previous runs)
  const targetDir = resolve(planDir, trackSlug, "design");
  mkdirSync(targetDir, { recursive: true });

  // Build focused prompts for each sub-agent
  const prdDesignPrompt = buildPhasedPrompt("prd-design", promptOpts);
  const wbOnlyPrompt = buildPhasedPrompt("wb-only", promptOpts);
  const supportDocsPrompt = buildPhasedPrompt("wb-execution", promptOpts);

  // Phase 1: PRD + design (runs first, WB depends on it)
  // Phase 2: WB-only + support docs (run after Phase 1)
  // WB-only is a dedicated agent — the most critical output
  const phase1Agents = [
    {
      name: "planner-prd",
      prompt: prdDesignPrompt,
      description: "PRD + design docs (spec, blueprint, domain-model)",
    },
  ];
  const phase2Agents = [
    {
      name: "planner-wb",
      prompt: wbOnlyPrompt,
      description: "Work breakdown ONLY (dedicated agent)",
    },
    {
      name: "planner-support",
      prompt: supportDocsPrompt,
      description: "Execution order + test strategy + work catalog",
    },
  ];
  const { saveAgentState, removeAgentState } = await import("../execution/agent-session.js");

  // Mux setup (optional — for daemon bidirectional communication)
  let mux: InstanceType<typeof import("../../bus/mux.js").ProcessMux> | null = null;
  let muxBackend = "raw";
  if (opts.useMux !== false) {
    try {
      const muxMod = await import("../../bus/mux.js");
      const candidate = new muxMod.ProcessMux();
      const backend = candidate.getBackend();
      if (backend !== "raw") {
        try { await candidate.cleanup(); } catch { /* stale session cleanup best-effort */ }
        // Verify psmux is healthy by listing sessions
        try {
          candidate.list();
          mux = candidate;
          muxBackend = backend;
        } catch {
          console.log("  \x1b[33m⚠\x1b[0m psmux unhealthy, using direct mode");
        }
      } else {
        mux = candidate;
        muxBackend = backend;
      }
    } catch { /* mux unavailable */ }
  }

  /**
   * Spawn a planner sub-agent.
   * CLI args properly separated: -p (user) + --append-system-prompt (system) + --output-format stream-json
   * Mux path: daemon bidirectional communication.
   * Fallback: direct runProviderCLI.
   */
  async function spawnAgent(agent: { name: string; prompt: string; description: string }) {
    console.log(`  \x1b[36m▶\x1b[0m ${agent.name}: ${agent.description}`);
    const sessionName = `quorum-${agent.name}-${Date.now()}`;

    try {
      let usedMux = false;
      if (mux && muxBackend !== "raw") {
        try {
          const muxArgs = buildPlannerCLIArgs(provider, agent.prompt, systemPrompt, repoRoot, true);
          const session = await mux.spawn({
            command: provider, args: muxArgs, cwd: repoRoot, name: sessionName,
          });
          if (session && session.status === "running") {
            saveAgentState(repoRoot, session.id, sessionName, muxBackend, agent.name, trackName);
            await pollMuxCompletion(mux, session.id, timeout);
            removeAgentState(repoRoot, session.id);
            await cleanupMuxSession(mux, session.id, "");
            usedMux = true;
          } else {
            console.log(`  \x1b[33m⚠\x1b[0m mux session failed to start, falling back to direct mode`);
          }
        } catch (muxErr) {
          console.log(`  \x1b[33m⚠\x1b[0m mux error (${(muxErr as Error).message}), falling back to direct mode`);
        }
      }
      if (!usedMux) {
        const directArgs = buildPlannerCLIArgs(provider, agent.prompt, systemPrompt, repoRoot);
        await runProviderCLI({ provider, args: directArgs, cwd: repoRoot, stdio: "inherit", timeout });
      }
      console.log(`  \x1b[32m✓\x1b[0m ${agent.name}: done`);
      return { name: agent.name, success: true };
    } catch (err) {
      console.log(`  \x1b[31m✗\x1b[0m ${agent.name}: ${(err as Error).message}`);
      return { name: agent.name, success: false, error: (err as Error).message };
    }
  }

  // Phase 1: PRD + design docs (must complete before Phase 2)
  console.log(`  \x1b[2mPhase 1: Design documents\x1b[0m`);
  const phase1Results = await Promise.allSettled(phase1Agents.map(spawnAgent));

  // Detect actual plan directory created by Phase 1 (agent may use different slug)
  let actualTrackSlug = trackSlug;
  try {
    const { readdirSync, statSync } = await import("node:fs");
    const entries = readdirSync(planDir).filter(e => {
      try { return statSync(resolve(planDir, e)).isDirectory(); } catch { return false; }
    });
    // Find the directory that has PRD.md (Phase 1 output)
    const match = entries.find(e => existsSync(resolve(planDir, e, "PRD.md")));
    if (match && match !== trackSlug) {
      console.log(`  \x1b[33m⚠\x1b[0m Plan directory: ${match} (expected: ${trackSlug})`);
      actualTrackSlug = match;
    }
  } catch { /* planDir may not exist yet */ }

  // Rebuild Phase 2 prompts with actual directory path
  const phase2PromptOpts = { ...promptOpts, trackSlug: actualTrackSlug };
  const actualWbPrompt = buildPhasedPrompt("wb-only", phase2PromptOpts);
  const actualSupportPrompt = buildPhasedPrompt("wb-execution", phase2PromptOpts);
  phase2Agents[0].prompt = actualWbPrompt;
  phase2Agents[1].prompt = actualSupportPrompt;

  // Phase 2: WB (dedicated) + support docs (parallel, after design docs exist)
  console.log(`  \x1b[2mPhase 2: Work breakdown + support\x1b[0m`);
  const phase2Results = await Promise.allSettled(phase2Agents.map(spawnAgent));

  const results = [...phase1Results, ...phase2Results];
  if (mux) { try { await mux.cleanup(); } catch { /* ignore */ } }

  // Check results
  const failures = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success));
  if (failures.length > 0) {
    console.log(`\n  \x1b[33m⚠\x1b[0m ${failures.length}/${phase1Agents.length + phase2Agents.length} sub-agent(s) failed`);
  }

  // Verify WB file exists (use actual directory, not expected slug)
  const wbPath = resolve(planDir, actualTrackSlug, "work-breakdown.md");
  if (!existsSync(wbPath)) {
    console.log(`  \x1b[31m✗\x1b[0m work-breakdown.md not found — retrying WB agent...`);
    const retryPrompt = `CRITICAL: Read ALL files in ${planDir}/${trackSlug}/ first, then use the Write tool to create work-breakdown.md. This is the ONLY file you need to create. Follow the WB schema exactly. Do NOT explain. WRITE THE FILE AND EXIT.`;
    const retryArgs = buildPlannerCLIArgs(provider, retryPrompt, systemPrompt, repoRoot);
    try {
      await runProviderCLI({ provider, args: retryArgs, cwd: repoRoot, stdio: "inherit", timeout });
    } catch { /* retry best-effort */ }
  }

  return { autoMode: true, provider, trackName, trackSlug: actualTrackSlug };
}

// ── Internal helpers ──────────────────────────

/** Slugify a track name for use as directory name. Max 60 chars, cut on word boundary. */
export function slugify(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    || "track";

  // Cap at 60 chars, cutting on word boundary
  if (slug.length > 60) {
    slug = slug.slice(0, 60).replace(/-[^-]*$/, "");
  }
  return slug || "track";
}

/**
 * Build CLI args. If the system prompt exceeds 16KB, write it to a temp file
 * and pass the file path instead — avoids OS command-line length limits.
 */
function buildCLIArgs(provider: string, systemPrompt: string, initialPrompt: string, autoMode: boolean, repoRoot: string): { args: string[]; tempFiles: string[] } {
  const args: string[] = [];
  const tempFiles: string[] = [];

  // Always write prompts to files — avoids cmd.exe 8191-char limit in psmux .cmd scripts
  const tmpDir = resolve(repoRoot, ".claude", "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const ts = Date.now();
  const sysPath = resolve(tmpDir, `planner-system-${ts}.md`);
  const promptPath = resolve(tmpDir, `planner-prompt-${ts}.md`);
  writeFileSync(sysPath, systemPrompt, "utf8");
  writeFileSync(promptPath, initialPrompt, "utf8");
  tempFiles.push(sysPath, promptPath);

  if (provider === "claude") {
    if (autoMode) {
      args.push("-p", `Read and follow the instructions in: ${promptPath}\nAlso read system instructions in: ${sysPath}`, "--dangerously-skip-permissions");
    } else {
      args.push("--append-system-prompt", `Read and follow the system instructions in: ${sysPath}`, `Read and follow the instructions in: ${promptPath}`);
    }
  } else if (provider === "codex") {
    args.push("--instructions", `Read instructions from: ${sysPath}`);
    if (autoMode) args.push("--full-auto");
  } else {
    args.push("--system-prompt", `Read instructions from: ${sysPath}`);
  }
  return { args, tempFiles };
}

/**
 * Build CLI args for planner sub-agents.
 * Properly separates: -p (user prompt) + --append-system-prompt (system prompt).
 *
 * @param streamJson — true for mux path (daemon needs ndjson), false for inherit path (user sees normal output)
 */
function buildPlannerCLIArgs(provider: string, userPrompt: string, sysPrompt: string, repoRoot: string, streamJson = false): string[] {
  if (provider === "claude") {
    const tmpDir = resolve(repoRoot, ".claude", "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const ts = Date.now();
    const sysPath = resolve(tmpDir, `planner-system-${ts}.md`);
    const promptPath = resolve(tmpDir, `planner-prompt-${ts}.md`);
    writeFileSync(sysPath, sysPrompt, "utf8");
    writeFileSync(promptPath, userPrompt, "utf8");
    const args = [
      "-p", `Read and follow the instructions in: ${promptPath}`,
      "--append-system-prompt", `Read and follow the system instructions in: ${sysPath}`,
      "--dangerously-skip-permissions",
    ];
    if (streamJson) args.push("--output-format", "stream-json");
    return args;
  }
  if (provider === "codex") {
    return ["exec", "--full-auto", "--instructions", sysPrompt, "-"];
  }
  return ["--system-prompt", sysPrompt, userPrompt];
}

async function executeMux(repoRoot: string, provider: string, cliArgs: string[], trackName: string, autoMode: boolean, timeout?: number): Promise<void> {
  const result = await detectMuxBackend();

  if (!result) {
    console.log("  \x1b[33mMux unavailable, falling back to direct mode.\x1b[0m\n");
    await runProviderCLI({ provider, args: cliArgs, cwd: repoRoot, stdio: "inherit", timeout });
    return;
  }

  const { mux, backend } = result;

  if (backend === "raw") {
    console.log("  \x1b[33mNo mux backend (psmux/tmux). Falling back to direct mode.\x1b[0m\n");
    await runProviderCLI({ provider, args: cliArgs, cwd: repoRoot, stdio: "inherit", timeout });
    return;
  }

  console.log(`  \x1b[2mMux: ${backend} (visible in daemon [3] Agent Chat)\x1b[0m\n`);

  const handle = await spawnMuxSession({ mux, repoRoot, provider, args: cliArgs, role: "planner", trackName });

  if (!handle) {
    console.log("  \x1b[31mMux spawn failed. Falling back to direct mode.\x1b[0m\n");
    try { await mux.cleanup(); } catch (err) { console.warn(`[planner-session] mux cleanup failed: ${(err as Error).message}`); }
    await runProviderCLI({ provider, args: cliArgs, cwd: repoRoot, stdio: "inherit", timeout });
    return;
  }

  const { session, stateFile } = handle;

  if (autoMode || !process.stdin.isTTY) {
    // Auto mode or non-interactive (piped) — poll for completion.
    // attach requires an interactive terminal.
    await pollMuxCompletion(mux, session.id);
  } else {
    mux.attach(session.id);
  }

  await cleanupMuxSession(mux, session.id, stateFile);
}
