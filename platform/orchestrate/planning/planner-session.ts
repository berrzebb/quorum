/**
 * Planner session orchestration — the high-level flow that ties
 * CPS loading → mode determination → prompt building → provider execution.
 *
 * Combines all extracted planning modules into a single session controller.
 */

import { resolve } from "node:path";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { loadCPS, loadPlannerProtocol } from "./cps-loader.js";
import { buildPlannerSystemPrompt, buildSocraticPrompt, buildInlineAutoPrompt, derivePrefix } from "./planner-prompts.js";
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
      if (provider === "claude") cliArgs.push("--dangerously-skip-permissions");
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

  // Write large system prompts to file to avoid CLI arg length limits
  let systemArg = systemPrompt;
  if (systemPrompt.length > 16_000) {
    const tmpDir = resolve(repoRoot, ".claude", "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const tmpPath = resolve(tmpDir, `planner-system-${Date.now()}.md`);
    writeFileSync(tmpPath, systemPrompt, "utf8");
    tempFiles.push(tmpPath);
    systemArg = `See system prompt in file: ${tmpPath}`;
  }

  if (provider === "claude") {
    if (autoMode) {
      // For large prompts, combine into -p so Claude reads both
      if (tempFiles.length > 0) {
        args.push("-p", `Read the system instructions from ${tempFiles[0]} first, then:\n\n${initialPrompt}`, "--dangerously-skip-permissions");
      } else {
        args.push("-p", initialPrompt, "--append-system-prompt", systemArg, "--dangerously-skip-permissions");
      }
    } else {
      args.push("--append-system-prompt", systemArg, initialPrompt);
    }
  } else if (provider === "codex") {
    args.push("--instructions", systemArg);
    if (autoMode) args.push("--full-auto");
  } else {
    args.push("--system-prompt", systemArg);
  }
  return { args, tempFiles };
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

  if (autoMode) {
    await pollMuxCompletion(mux, session.id);
  } else {
    mux.attach(session.id);
  }

  await cleanupMuxSession(mux, session.id, stateFile);
}
