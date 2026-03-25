/**
 * Interactive planner — Socratic questioning + CPS intake + parliament feedback.
 *
 * Replaces the deprecated interview.ts command. Spawns an LLM CLI session
 * with stdio:"inherit" for direct user conversation.
 *
 * --mux: Spawn in a mux session for daemon observability. The user still
 * interacts directly (auto-attach), but the daemon can observe live output.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DIST, findTracks, resolveTrack, trackRef } from "./shared.js";

export async function interactivePlanner(repoRoot: string, args: string[]): Promise<void> {
  const providerIdx = args.indexOf("--provider");
  const provider = providerIdx >= 0 ? args[providerIdx + 1] ?? "claude" : "claude";
  const useMux = args.includes("--mux");
  const useAuto = args.includes("--auto");
  const providerValue = providerIdx >= 0 ? args[providerIdx + 1] : undefined;
  const trackInput = args.find(a => !a.startsWith("--") && a !== providerValue);

  // Resolve track: name, index, or auto-select
  const trackName = trackInput ?? (findTracks(repoRoot).length === 1 ? findTracks(repoRoot)[0]!.name : undefined);

  if (!trackName) {
    console.log("  Usage: quorum orchestrate plan <track|index> [--provider claude|codex|gemini] [--mux]\n");
    const tracks = findTracks(repoRoot);
    if (tracks.length > 0) {
      console.log("  Available tracks:");
      for (let i = 0; i < tracks.length; i++) {
        console.log(`    ${i + 1}. ${tracks[i]!.name} (${tracks[i]!.items} items)`);
      }
      console.log();
    }
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
  const socraticPrompt = `Plan track "${trackName}". ${cpsContent ? "CPS is available — use it." : "No CPS — start with Socratic questions to clarify requirements."}`;
  const autoPrompt = `Plan track "${trackName}" using the CPS provided. Generate ALL documents now without asking questions:
1. Write PRD to ${planDir}/${trackName}/PRD.md
2. Write Design (spec, blueprint with naming conventions, domain model) to ${planDir}/${trackName}/design/
3. Write Work Breakdown to ${planDir}/${trackName}/work-breakdown.md with IDs ${prefix}-1, ${prefix}-2, ...

Use CPS.Context for PRD§1, CPS.Problem for PRD§2, CPS.Solution for PRD§4. Make reasonable decisions where CPS has gaps. Be concrete, not abstract.`;

  // Auto mode: CPS-driven non-interactive generation (no Socratic needed)
  const autoMode = useAuto || (!useMux && cpsContent && !process.stdin.isTTY);
  console.log(`  Track: ${trackName}, Provider: ${provider}, CPS: ${cpsContent ? "yes" : "Socratic"}${useMux ? ", Mux: on" : ""}${autoMode ? ", Auto: on" : ""}\n`);

  // Build CLI args
  const initialPrompt = autoMode ? autoPrompt : socraticPrompt;
  const cliArgs: string[] = [];
  if (provider === "claude") {
    if (autoMode) {
      // Non-interactive: -p sends prompt and exits
      cliArgs.push("-p", initialPrompt, "--append-system-prompt", systemPrompt, "--dangerously-skip-permissions");
    } else {
      cliArgs.push("--append-system-prompt", systemPrompt, initialPrompt);
    }
  } else if (provider === "codex") {
    cliArgs.push("--instructions", systemPrompt);
    if (autoMode) cliArgs.push("--full-auto");
  } else {
    cliArgs.push("--system-prompt", systemPrompt);
  }

  if (useMux) {
    // Mux mode runs unattended — bypass approval prompts
    if (provider === "claude") cliArgs.push("--dangerously-skip-permissions");
    await runWithMux(repoRoot, provider, cliArgs, trackName);
  } else {
    await runDirect(repoRoot, provider, cliArgs);
  }

  const wbPath = resolve(planDir, trackName, "work-breakdown.md");
  if (existsSync(wbPath)) {
    const ref = trackRef(trackName, repoRoot);
    const arg = ref ? ` ${ref}` : "";
    console.log(`\n  \x1b[32m✓ WBs generated.\x1b[0m Next: quorum orchestrate run${arg}\n`);
  }
}

// ── Direct mode (current behavior) ──────────

async function runDirect(repoRoot: string, provider: string, cliArgs: string[]): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const quorumRoot = resolve(DIST, "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  spawnSync(bin, cliArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
  });
}

// ── Mux mode (daemon observable) ────────────

async function runWithMux(repoRoot: string, provider: string, cliArgs: string[], trackName: string): Promise<void> {
  const toURL = (p: string) => pathToFileURL(p).href;
  let ProcessMux: typeof import("../../../bus/mux.js").ProcessMux;
  try {
    const muxMod = await import(toURL(resolve(DIST, "bus", "mux.js")));
    ProcessMux = muxMod.ProcessMux;
  } catch {
    console.log("  \x1b[33mMux unavailable, falling back to direct mode.\x1b[0m\n");
    return runDirect(repoRoot, provider, cliArgs);
  }

  const mux = new ProcessMux();
  const backend = mux.getBackend();

  if (backend === "raw") {
    console.log("  \x1b[33mNo mux backend (psmux/tmux). Falling back to direct mode.\x1b[0m\n");
    return runDirect(repoRoot, provider, cliArgs);
  }

  console.log(`  \x1b[2mMux: ${backend} (visible in daemon [3] Agent Chat)\x1b[0m\n`);

  const sessionName = `quorum-plan-${Date.now()}`;
  const session = await mux.spawn({
    name: sessionName,
    command: provider,
    args: cliArgs,
    cwd: repoRoot,
    env: { FEEDBACK_LOOP_ACTIVE: "1" },
  });

  if (session.status === "error") {
    console.log("  \x1b[31mFailed to create mux session.\x1b[0m\n");
    await mux.cleanup();
    return runDirect(repoRoot, provider, cliArgs);
  }

  // Save agent state for daemon discovery
  const agentState = {
    id: session.id,
    name: session.name,
    pid: session.pid,
    backend: session.backend,
    role: "planner",
    type: "planner",
    trackName,
    startedAt: session.startedAt,
    status: session.status,
  };
  const agentsDir = resolve(repoRoot, ".claude", "agents");
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
  const stateFile = resolve(agentsDir, `${session.id}.json`);
  writeFileSync(stateFile, JSON.stringify(agentState, null, 2), "utf8");

  // Attach — user interacts directly, daemon observes simultaneously
  mux.attach(session.id);

  // Cleanup after user exits/detaches
  try { rmSync(stateFile, { force: true }); } catch { /* ok */ }
  try { await mux.kill(session.id); } catch { /* ok */ }
  await mux.cleanup();
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

## Work Breakdown Schema

Each WB item MUST include these fields. The goal: a sub-agent can complete this item in ONE pass without asking questions.

\`\`\`markdown
## ${prefix}-N: Title (Size: XS|S|M)

- **First touch files**: \`path/file.ext\` — reason for each
- **Prerequisite**: ${prefix}-X (or none)
- **Action**: Concrete steps. NOT "implement X" — instead: "Add function Y to file Z that does W. Call it from Q."
- **Context budget**:
  - Read: \`file1.ts\` (interface), \`file2.ts\` (usage pattern) — files the agent MUST read
  - Skip: \`large-module/\` — files the agent must NOT explore (use tools instead)
- **Verify**: Exact command(s) to confirm completion.
  \`npm test -- tests/foo.test.mjs\` or \`npx tsc --noEmit\` — NOT prose.
- **Constraints**: What this WB must NOT do. Scope boundary.
  e.g. "Do NOT modify the public API" / "Do NOT add new dependencies"
- **Done**: Machine-checkable condition. e.g. "test X passes AND tsc clean"
\`\`\`

**Sizing rule**: If a WB needs >3 files or >250 lines of changes, split it.
**Action rule**: Write actions as if giving instructions to a new team member on their first day.
**Context budget rule**: List ONLY files needed — less is more. Agents use \`code_map\`/\`blast_radius\` for discovery.
**Verify rule**: Must be a runnable command, not "verify it works."

Rules: Design MANDATORY. Blueprint naming = law. Ask before assuming. User's language.

${protocol}`;
}
