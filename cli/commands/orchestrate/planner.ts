/**
 * Interactive planner — Socratic questioning + CPS intake + parliament feedback.
 *
 * Replaces the deprecated interview.ts command. Spawns an LLM CLI session
 * with stdio:"inherit" for direct user conversation.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DIST, findTracks } from "./shared.js";

export async function interactivePlanner(repoRoot: string, args: string[]): Promise<void> {
  const trackName = args[0];
  const providerIdx = args.indexOf("--provider");
  const provider = providerIdx >= 0 ? args[providerIdx + 1] ?? "claude" : "claude";

  if (!trackName) {
    console.log("  Usage: quorum orchestrate plan <track> [--provider claude|codex|gemini]\n");
    console.log("  Interactive planner with Socratic questioning. Reads CPS if available.\n");
    return;
  }

  console.log(`\n\x1b[36mquorum orchestrate plan\x1b[0m\n`);

  // Load CPS
  let cpsContent = "";
  const cpsDir = resolve(repoRoot, ".claude", "parliament");
  if (existsSync(cpsDir)) {
    const cpsFiles = readdirSync(cpsDir).filter(f => f.startsWith("cps-") && f.endsWith(".md"));
    if (cpsFiles.length > 0) {
      cpsContent = readFileSync(resolve(cpsDir, cpsFiles[cpsFiles.length - 1]!), "utf8");
      console.log(`  \x1b[32m✓\x1b[0m CPS loaded`);
    }
  }

  // Load planner protocol
  let protocol = "";
  for (const p of [resolve(repoRoot, "skills", "planner", "SKILL.md")]) {
    if (existsSync(p)) { protocol = readFileSync(p, "utf8"); break; }
  }

  const planDir = resolve(repoRoot, "docs", "plan");
  const prefix = trackName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const systemPrompt = buildSystemPrompt(trackName, cpsContent, protocol, planDir, prefix);

  console.log(`  Track: ${trackName}, Provider: ${provider}, CPS: ${cpsContent ? "yes" : "Socratic"}\n`);

  // Spawn interactive LLM session (NOT -p/print mode)
  // System prompt is injected via --append-system-prompt (Claude) or temp file
  const { spawnSync } = await import("node:child_process");
  // cli-runner.mjs is a source MJS file (not compiled to dist/), resolve from package root
  const quorumRoot = resolve(DIST, "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  // Build CLI args: system prompt + initial message (the topic)
  const initialPrompt = `Plan track "${trackName}". ${cpsContent ? "CPS is available — use it." : "No CPS — start with Socratic questions to clarify requirements."}`;

  const cliArgs: string[] = [];
  if (provider === "claude") {
    cliArgs.push("--append-system-prompt", systemPrompt, "-p", initialPrompt, "--resume");
  } else if (provider === "codex") {
    cliArgs.push("--instructions", systemPrompt);
  } else {
    cliArgs.push("--system-prompt", systemPrompt);
  }

  spawnSync(bin, cliArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
  });

  const wbPath = resolve(planDir, trackName, "work-breakdown.md");
  if (existsSync(wbPath)) {
    console.log(`\n  \x1b[32m✓ WBs generated.\x1b[0m Next: quorum orchestrate run ${trackName}\n`);
  }
}

/** Headless WB generation from CPS (used by orchestrate run when WBs missing). */
export async function autoGenerateWBs(repoRoot: string, trackName: string, provider: string): Promise<boolean> {
  const cpsDir = resolve(repoRoot, ".claude", "parliament");
  const cpsFiles = existsSync(cpsDir)
    ? readdirSync(cpsDir).filter(f => f.startsWith("cps-") && f.endsWith(".md"))
    : [];

  if (cpsFiles.length === 0) {
    console.log("  \x1b[33mNo CPS found. Run parliament first.\x1b[0m\n");
    return false;
  }

  const latestCps = readFileSync(resolve(cpsDir, cpsFiles[cpsFiles.length - 1]!), "utf8");
  console.log(`  \x1b[36mAuto-planning from CPS...\x1b[0m\n`);

  let protocol = "";
  const skillPath = resolve(repoRoot, "skills", "planner", "SKILL.md");
  if (existsSync(skillPath)) protocol = readFileSync(skillPath, "utf8");

  const toURL = (p: string) => pathToFileURL(p).href;
  let ProcessMux;
  try {
    const muxMod = await import(toURL(resolve(DIST, "bus", "mux.js")));
    ProcessMux = muxMod.ProcessMux;
  } catch { return false; }

  const mux = new ProcessMux();
  const planningDir = resolve(repoRoot, "docs", "plan");
  const prefix = trackName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);

  try {
    const session = await mux.spawn({
      name: `quorum-planner-${Date.now()}`,
      command: provider,
      args: provider === "codex" ? ["exec", "--json", "-"] : ["-p", "--output-format", "stream-json"],
      cwd: repoRoot,
      env: { FEEDBACK_LOOP_ACTIVE: "1" },
    });

    const prompt = `# Auto-Planning from Parliament CPS\n\n${latestCps}\n\nTrack: ${trackName}\nWrite WBs to: ${planningDir}/${trackName}/work-breakdown.md\nIDs: ${prefix}-1, ${prefix}-2, ...\n\n${protocol}`;
    mux.send(session.id, prompt);

    const timeout = 180_000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 5000));
      const cap = mux.capture(session.id, 200);
      if (!cap) continue;
      if (cap.output.includes('"type":"result"') || cap.output.includes('"stop_reason"') || cap.output.includes('"type":"turn.completed"')) break;
    }

    await mux.kill(session.id);
    await mux.cleanup();

    return findTracks(repoRoot).some(t => t.name === trackName);
  } catch {
    await mux.cleanup();
    return false;
  }
}

function buildSystemPrompt(trackName: string, cps: string, protocol: string, planDir: string, prefix: string): string {
  const cpsSection = cps
    ? `## Parliament CPS (Phase 0)\n${cps}\nMap: Context→PRD§1, Problem→PRD§2, Solution→PRD§4.`
    : "## No CPS — Socratic mode. Ask: What problem? Who benefits? Done criteria? Out of scope? Constraints?";

  return `# Planner: ${trackName}
Output to: ${planDir}/${trackName}/

${cpsSection}

## Parliament Feedback
If ambiguity cannot be resolved: tell user to run quorum parliament "<topic>".

## Output
1. PRD (${planDir}/${trackName}/PRD.md)
2. Design: Spec, Blueprint (Naming Conventions!), Domain Model, Architecture (${planDir}/${trackName}/design/)
3. Work Breakdown (${planDir}/${trackName}/work-breakdown.md) — IDs: ${prefix}-1, ${prefix}-2, ...

Rules: Design MANDATORY. Blueprint naming = law. Ask before assuming. User's language.

${protocol}`;
}
