/**
 * quorum orchestrate — select tracks, distribute to agents, monitor progress.
 *
 * The orchestrator is the "facilitator" (not dictator):
 * 1. Read execution order → pick unblocked tracks
 * 2. Scout RTM for selected track
 * 3. Spawn implementer agents via ProcessMux
 * 4. Monitor progress → correction on rejection
 * 5. Trigger retro + merge on completion
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "..", "..");

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const subcommand = args[0] ?? "start";

  switch (subcommand) {
    case "start":
      await startOrchestration(repoRoot, args.slice(1));
      break;
    case "run":
      await runImplementationLoop(repoRoot, args.slice(1));
      break;
    case "assign":
      await assignTrack(repoRoot, args[1], args.slice(2));
      break;
    case "progress":
      await showProgress(repoRoot);
      break;
    default:
      showHelp();
  }
}

async function startOrchestration(repoRoot: string, args: string[]): Promise<void> {
  console.log("\n\x1b[36mquorum orchestrate\x1b[0m — session orchestration\n");

  // 1. Find execution order
  const tracks = findTracks(repoRoot);
  if (tracks.length === 0) {
    console.log("  No tracks found. Run 'quorum plan' or '/quorum:planner' first.\n");
    return;
  }

  // 2. Show available tracks
  console.log("  \x1b[1mAvailable tracks:\x1b[0m\n");
  for (let i = 0; i < tracks.length; i++) {
    console.log(`    ${i + 1}. ${tracks[i]!.name} (${tracks[i]!.items} items)`);
  }

  // 3. If track specified in args, use it
  const targetTrack = args[0];
  if (targetTrack) {
    const track = tracks.find((t) => t.name === targetTrack);
    if (!track) {
      console.log(`\n  Track '${targetTrack}' not found.\n`);
      return;
    }
    await orchestrateTrack(repoRoot, track);
    return;
  }

  // 4. Interactive selection
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((r) =>
    rl.question("\n  Select track number (or 'q' to quit): ", r),
  );
  rl.close();

  if (answer.trim().toLowerCase() === "q") return;

  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= tracks.length) {
    console.log("  Invalid selection.\n");
    return;
  }

  await orchestrateTrack(repoRoot, tracks[idx]!);
}

async function orchestrateTrack(
  repoRoot: string,
  track: { name: string; path: string; items: number },
): Promise<void> {
  console.log(`\n  \x1b[1mOrchestrating: ${track.name}\x1b[0m (${track.items} items)\n`);

  const toURL = (p: string) => pathToFileURL(p).href;
  let bridge: Record<string, Function> | null = null;

  try {
    bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
    await bridge!.init(repoRoot);
  } catch { /* bridge non-critical */ }

  // 1. Parse work breakdown → WorkItem[]
  const workItems = parseWorkBreakdown(track.path);

  // 2. Select execution mode
  if (bridge?.selectExecutionMode && workItems.length > 0) {
    const selection = bridge.selectExecutionMode(workItems);
    if (selection) {
      console.log(`  \x1b[1mExecution mode:\x1b[0m ${selection.mode}`);
      console.log(`  \x1b[1mMax concurrency:\x1b[0m ${selection.maxConcurrency}`);
      if (selection.reasons.length > 0) {
        console.log(`  \x1b[1mReasons:\x1b[0m ${selection.reasons.join("; ")}`);
      }

      // Show execution groups
      if (selection.plan.groups.length > 0) {
        console.log(`\n  \x1b[1mExecution groups\x1b[0m (${selection.plan.depth} sequential steps):\n`);
        for (const group of selection.plan.groups) {
          const ids = group.items.map((i: { id: string }) => i.id).join(", ");
          console.log(`    Step ${group.order + 1}: [${ids}]  (${group.items.length} parallel)`);
        }
      }

      if (selection.plan.unschedulable.length > 0) {
        console.log(`\n  \x1b[33m⚠ Unschedulable:\x1b[0m ${selection.plan.unschedulable.join(", ")} (circular deps)`);
      }

      // Check existing claims
      if (bridge.validatePlanClaims && selection.plan) {
        const conflicts = bridge.validatePlanClaims(selection.plan, `orch-${track.name}`);
        if (conflicts.size > 0) {
          console.log(`\n  \x1b[31m✗ Claim conflicts:\x1b[0m`);
          for (const [itemId, itemConflicts] of conflicts) {
            const files = itemConflicts.map((c: { filePath: string; heldBy: string }) => `${c.filePath} (${c.heldBy})`).join(", ");
            console.log(`    ${itemId}: ${files}`);
          }
        }
      }
    }
  } else if (workItems.length === 0) {
    console.log("  \x1b[33mNo parseable work items found in breakdown.\x1b[0m");
  }

  // 3. Emit orchestration event
  if (bridge?.emitEvent) {
    try {
      bridge.emitEvent("track.create", "claude-code", {
        trackId: track.name,
        total: track.items,
        completed: 0,
        pending: track.items,
        blocked: 0,
      });
    } catch { /* non-critical */ }
  }

  console.log("\n  \x1b[1mNext steps:\x1b[0m");
  console.log(`    1. \x1b[32m✓\x1b[0m Track selected`);
  console.log(`    2. Run scout for RTM:  quorum agent spawn scout claude -p "scout ${track.name}"`);
  console.log(`    3. Assign to agent:    quorum orchestrate assign ${track.name} <agent-name>`);
  console.log(`    4. Monitor progress:   quorum orchestrate progress`);
  console.log(`    5. After approval:     quorum retro`);
  console.log(`    6. Merge:              quorum merge\n`);

  if (bridge?.close) bridge.close();
}

async function assignTrack(repoRoot: string, trackName: string | undefined, args: string[]): Promise<void> {
  if (!trackName) {
    console.log("  Usage: quorum orchestrate assign <track> [--agent <name>]\n");
    return;
  }

  const agentName = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : `impl-${trackName}`;

  // Find track's work breakdown
  const tracks = findTracks(repoRoot);
  const track = tracks.find((t) => t.name === trackName);

  let bridge: Record<string, Function> | null = null;
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
    await bridge!.init(repoRoot);
  } catch { /* non-critical */ }

  // Claim target files for this agent
  if (bridge?.claimFiles && track) {
    const workItems = parseWorkBreakdown(track.path);
    const allFiles = workItems.flatMap((i) => i.targetFiles);

    if (allFiles.length > 0) {
      const conflicts = bridge.claimFiles(agentName, allFiles, undefined, 600_000);
      if (conflicts.length > 0) {
        console.log(`\n  \x1b[31m✗ Cannot assign — file conflicts:\x1b[0m`);
        for (const c of conflicts) {
          console.log(`    ${c.filePath} → held by ${c.heldBy}`);
        }
        if (bridge?.close) bridge.close();
        return;
      }
      console.log(`  \x1b[32m✓\x1b[0m Claimed ${allFiles.length} file(s) for ${agentName}`);
    }
  }

  // Emit assignment event
  if (bridge?.emitEvent) {
    bridge.emitEvent("agent.spawn", "claude-code", {
      agentId: agentName,
      role: "implementer",
      trackId: trackName,
    });
  }

  console.log(`\n  \x1b[36mAssigning ${trackName} → ${agentName}\x1b[0m\n`);
  console.log("  To spawn the agent:");
  console.log(`    quorum agent spawn ${agentName} claude -p "implement track ${trackName}"`);
  console.log(`    quorum agent spawn ${agentName} codex exec "implement track ${trackName}"\n`);

  if (bridge?.close) bridge.close();
}

async function showProgress(repoRoot: string): Promise<void> {
  console.log("\n\x1b[36mquorum orchestrate progress\x1b[0m\n");

  let bridge: Record<string, Function> | null = null;
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
    await bridge!.init(repoRoot);
  } catch { /* non-critical */ }

  // Show active claims
  if (bridge?.getClaims) {
    const claims = bridge.getClaims();
    if (claims.length > 0) {
      console.log("  \x1b[1mActive file claims:\x1b[0m\n");
      const byAgent = new Map<string, string[]>();
      for (const c of claims) {
        const list = byAgent.get(c.agentId) ?? [];
        list.push(c.filePath);
        byAgent.set(c.agentId, list);
      }
      for (const [agent, files] of byAgent) {
        console.log(`    ${agent}: ${files.length} file(s)`);
        for (const f of files.slice(0, 5)) console.log(`      - ${f}`);
        if (files.length > 5) console.log(`      ... +${files.length - 5} more`);
      }
      console.log();
    }
  }

  // Show audit learnings
  if (bridge?.analyzeAuditLearnings) {
    const learnings = bridge.analyzeAuditLearnings();
    if (learnings?.patterns.length > 0) {
      console.log("  \x1b[1mRepeat patterns detected:\x1b[0m\n");
      for (const p of learnings.patterns.slice(0, 5)) {
        console.log(`    ${p.key} (${p.type}): ${p.count}× — severity: ${p.severity}`);
      }
      if (learnings.suggestions.length > 0) {
        console.log(`\n  \x1b[33m${learnings.suggestions.length} rule suggestion(s) for CLAUDE.md\x1b[0m`);
      }
      console.log();
    }
  }

  console.log("  Run 'quorum daemon' for real-time TUI dashboard.");
  console.log("  Or:  quorum status\n");

  if (bridge?.close) bridge.close();
}

function findTracks(repoRoot: string): { name: string; path: string; items: number }[] {
  const tracks: { name: string; path: string; items: number }[] = [];
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanDir(dir, tracks);
  }

  // Deduplicate by name (keep first found)
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

function scanDir(dir: string, tracks: { name: string; path: string; items: number }[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, tracks);
      } else if (entry.name.includes("work-breakdown") && entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf8");
        const bracketItems = content.match(/^###?\s+\[/gm) ?? [];
        const idItems = content.match(/^##\s+[A-Z]{2,}-\d+/gm) ?? [];
        tracks.push({
          name: basename(resolve(fullPath, "..")),
          path: fullPath,
          items: Math.max(bracketItems.length, idItems.length),
        });
      }
    }
  } catch { /* skip */ }
}

// ── Work Breakdown Parser ──

interface WorkItem {
  id: string;
  targetFiles: string[];
  dependsOn?: string[];
}

/**
 * Parse a work-breakdown.md into WorkItem[] suitable for planParallel/selectMode.
 *
 * Expected format:
 *   ## TRACK-1 Title
 *   - Prerequisite: TRACK-0
 *   - First touch files:
 *     - `src/foo.ts` — description
 */
function parseWorkBreakdown(wbPath: string): WorkItem[] {
  let content: string;
  try {
    content = readFileSync(wbPath, "utf8");
  } catch {
    return [];
  }

  const items: WorkItem[] = [];
  // Match section headers: ## XX-1 or ### [XX-1]
  const sectionRegex = /^#{2,3}\s+(?:\[)?([A-Z][A-Z0-9]*-\d+)\]?\s+/gm;
  const sections: { id: string; start: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({ id: match[1]!, start: match.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const end = i + 1 < sections.length ? sections[i + 1]!.start : content.length;
    const body = content.slice(section.start, end);

    // Extract prerequisite/depends_on
    const depsMatch = body.match(/(?:Prerequisite|depends_on)[:\s]+(.+)/i);
    const dependsOn: string[] = [];
    if (depsMatch) {
      const depStr = depsMatch[1]!;
      const depIds = depStr.match(/[A-Z][A-Z0-9]*-\d+/g);
      if (depIds) dependsOn.push(...depIds);
    }

    // Extract first touch files (backtick-quoted paths)
    const targetFiles: string[] = [];
    const fileRegex = /`([^`]+\.[a-z]{1,5})`/g;
    const firstTouchStart = body.indexOf("First touch files");
    if (firstTouchStart !== -1) {
      // Only scan the First touch files section
      const nextSection = body.indexOf("\n- **", firstTouchStart + 1);
      const fileBlock = nextSection !== -1
        ? body.slice(firstTouchStart, nextSection)
        : body.slice(firstTouchStart, Math.min(firstTouchStart + 500, body.length));
      let fileMatch: RegExpExecArray | null;
      while ((fileMatch = fileRegex.exec(fileBlock)) !== null) {
        targetFiles.push(fileMatch[1]!);
      }
    }

    items.push({
      id: section.id,
      targetFiles,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    });
  }

  return items;
}

// ── Implementation Loop ─────────────────────

async function runImplementationLoop(repoRoot: string, args: string[]): Promise<void> {
  const trackName = args[0];
  const provider = args.includes("--provider") ? args[args.indexOf("--provider") + 1] ?? "claude" : "claude";
  const maxRetries = 3;

  if (!trackName) {
    console.log("  Usage: quorum orchestrate run <track> [--provider claude|codex|gemini]\n");
    return;
  }

  console.log(`\n\x1b[36mquorum orchestrate run\x1b[0m — implementation loop\n`);
  console.log(`  Track:    ${trackName}`);
  console.log(`  Provider: ${provider}\n`);

  let tracks = findTracks(repoRoot);
  let track = tracks.find(t => t.name === trackName);

  // Loop 1: If no track/WBs exist, auto-invoke planner from CPS
  if (!track || parseWorkBreakdown(track.path).length === 0) {
    const generated = await autoGenerateWBs(repoRoot, trackName, provider);
    if (!generated) {
      console.log(`  \x1b[31mNo WBs for '${trackName}' and auto-generation failed.\x1b[0m`);
      console.log(`  Run planner manually or check CPS: quorum parliament --history\n`);
      return;
    }
    // Re-scan after generation
    tracks = findTracks(repoRoot);
    track = tracks.find(t => t.name === trackName);
    if (!track) {
      console.log(`  \x1b[31mTrack still not found after planner.\x1b[0m\n`);
      return;
    }
  }

  const workItems = parseWorkBreakdown(track.path);
  if (workItems.length === 0) {
    console.log("  \x1b[33mNo parseable work items after planning.\x1b[0m\n");
    return;
  }

  // Init bridge
  const toURL = (p: string) => pathToFileURL(p).href;
  let bridge: Record<string, Function> | null = null;
  try {
    bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
    await bridge!.init(repoRoot);
  } catch { /* non-critical */ }

  // Parliament gates
  if (bridge?.checkParliamentGates) {
    const gate = bridge.checkParliamentGates();
    if (!gate.allowed) {
      console.log(`  \x1b[31mParliament gate:\x1b[0m ${gate.reason}\n`);
      if (bridge?.close) bridge.close();
      return;
    }
  }

  // Execution groups (dependency-aware)
  let groups: Array<{ items: WorkItem[] }> = [];
  if (bridge?.selectExecutionMode) {
    const sel = bridge.selectExecutionMode(workItems);
    if (sel?.plan?.groups) {
      groups = sel.plan.groups.map((g: { items: WorkItem[] }) => ({ items: g.items }));
      console.log(`  Mode: ${sel.mode}, ${groups.length} group(s)\n`);
    }
  }
  if (groups.length === 0) groups = workItems.map(i => ({ items: [i] }));

  // Init ProcessMux
  let mux: InstanceType<typeof import("../../bus/mux.js").ProcessMux>;
  try {
    const muxMod = await import(toURL(resolve(DIST, "bus", "mux.js")));
    mux = new muxMod.ProcessMux();
  } catch {
    console.log("  \x1b[31mProcessMux unavailable. Run: npm run build\x1b[0m\n");
    if (bridge?.close) bridge.close();
    return;
  }

  console.log(`  Mux: ${mux.getBackend()}\n${"═".repeat(60)}\n`);

  let completedWBs = 0;
  const totalWBs = workItems.length;

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]!;
    console.log(`  \x1b[1mGroup ${gi + 1}/${groups.length}\x1b[0m (${group.items.length} items)\n`);

    const active: Array<{ item: WorkItem; sessionId: string; retries: number }> = [];

    // Spawn agents for group
    for (const item of group.items) {
      if (bridge?.claimFiles && item.targetFiles.length > 0) {
        bridge.claimFiles(`impl-${item.id}`, item.targetFiles, undefined, 1800_000);
      }

      try {
        const cliArgs = provider === "codex"
          ? ["exec", "--json", "-"]
          : ["-p", "--output-format", "stream-json"];

        const session = await mux.spawn({
          name: `quorum-impl-${item.id}-${Date.now()}`,
          command: provider,
          args: cliArgs,
          cwd: repoRoot,
          env: { FEEDBACK_LOOP_ACTIVE: "1" },
        });

        mux.send(session.id, buildImplementerPrompt(item, trackName, repoRoot));
        active.push({ item, sessionId: session.id, retries: 0 });
        console.log(`    \x1b[32m+\x1b[0m ${item.id} spawned`);

        if (bridge?.emitEvent) {
          bridge.emitEvent("agent.spawn", "claude-code", {
            agentId: `impl-${item.id}`, role: "implementer",
            trackId: trackName, wbId: item.id, sessionId: session.id,
          });
        }
      } catch (err) {
        console.log(`    \x1b[31m!\x1b[0m ${item.id} failed: ${(err as Error).message}`);
      }
    }

    // Poll loop
    const POLL = 5000;
    const TIMEOUT = 600_000;
    const start = Date.now();

    while (active.length > 0 && Date.now() - start < TIMEOUT) {
      await new Promise(r => setTimeout(r, POLL));

      for (let si = active.length - 1; si >= 0; si--) {
        const s = active[si]!;
        const cap = mux.capture(s.sessionId, 200);
        if (!cap) continue;

        const done = cap.output.includes('"type":"result"')
          || cap.output.includes('"type":"turn.completed"')
          || cap.output.includes('"stop_reason"');

        if (!done) continue;

        // Check verdict
        const verdicts = bridge?.queryEvents?.({ eventType: "audit.verdict" }) ?? [];
        const latest = verdicts.length > 0 ? verdicts[verdicts.length - 1] : null;
        const verdict = latest?.payload?.verdict as string | undefined;

        if (verdict === "approved") {
          console.log(`    \x1b[32m✓\x1b[0m ${s.item.id} approved`);
          completedWBs++;
          active.splice(si, 1);
          try { await mux.kill(s.sessionId); } catch { /* ok */ }
        } else if (verdict === "changes_requested" && s.retries < maxRetries) {
          s.retries++;
          console.log(`    \x1b[33m↻\x1b[0m ${s.item.id} correction ${s.retries}/${maxRetries}`);
          mux.send(s.sessionId, "Your submission was rejected. Check: quorum tool audit_history --summary --json\nFix issues and resubmit evidence with [REVIEW_NEEDED].");
        } else {
          console.log(`    \x1b[31m✗\x1b[0m ${s.item.id} ${verdict ?? "timeout"}`);
          active.splice(si, 1);
          try { await mux.kill(s.sessionId); } catch { /* ok */ }
        }
      }

      const pct = totalWBs > 0 ? Math.round((completedWBs / totalWBs) * 100) : 0;
      const sec = Math.round((Date.now() - start) / 1000);
      process.stdout.write(`\r    [${completedWBs}/${totalWBs}] ${pct}% ${sec}s ${active.length} active    `);
    }

    console.log();

    // Cleanup timed-out sessions
    for (const s of active) {
      try { await mux.kill(s.sessionId); } catch { /* ok */ }
    }
    for (const item of group.items) {
      if (bridge?.releaseFiles) bridge.releaseFiles(`impl-${item.id}`);
    }
  }

  // Summary
  console.log(`\n${"═".repeat(60)}\n`);
  console.log(`  \x1b[1mResult:\x1b[0m ${completedWBs}/${totalWBs} WBs completed`);

  if (completedWBs === totalWBs) {
    console.log("  \x1b[32m✓ Track complete!\x1b[0m\n");
    if (bridge?.emitEvent) {
      bridge.emitEvent("track.complete", "claude-code", { trackId: trackName, total: totalWBs });
    }

    // Loop 2: Auto-retro
    console.log("  \x1b[36mAuto-retro...\x1b[0m");
    await autoRetro(repoRoot);

    // Loop 3: Auto-merge (if in worktree)
    await autoMerge(repoRoot, bridge);
  } else {
    console.log(`  \x1b[33m${totalWBs - completedWBs} incomplete. Run again or check progress.\x1b[0m\n`);
  }

  await mux.cleanup();
  if (bridge?.close) bridge.close();
}

// ── Auto-generate WBs from CPS ──────────────

async function autoGenerateWBs(repoRoot: string, trackName: string, provider: string): Promise<boolean> {
  // Check if CPS exists
  const cpsDir = resolve(repoRoot, ".claude", "parliament");
  const cpsFiles = existsSync(cpsDir)
    ? readdirSync(cpsDir).filter(f => f.startsWith("cps-") && f.endsWith(".md"))
    : [];

  if (cpsFiles.length === 0) {
    console.log("  \x1b[33mNo CPS found. Run parliament first: quorum parliament \"topic\"\x1b[0m\n");
    return false;
  }

  const latestCps = readFileSync(resolve(cpsDir, cpsFiles[cpsFiles.length - 1]!), "utf8");
  console.log(`  \x1b[36mAuto-planning from CPS...\x1b[0m\n`);

  // Read planner skill protocol
  let plannerProtocol = "";
  const skillPaths = [
    resolve(repoRoot, "skills", "planner", "SKILL.md"),
    resolve(repoRoot, "adapters", "claude-code", "skills", "planner", "SKILL.md"),
  ];
  for (const p of skillPaths) {
    if (existsSync(p)) { plannerProtocol = readFileSync(p, "utf8"); break; }
  }

  // Spawn planner agent via ProcessMux
  const toURL = (p: string) => pathToFileURL(p).href;
  let ProcessMux;
  try {
    const muxMod = await import(toURL(resolve(DIST, "bus", "mux.js")));
    ProcessMux = muxMod.ProcessMux;
  } catch { return false; }

  const mux = new ProcessMux();
  const planningDir = resolve(repoRoot, "docs", "plan");

  try {
    const session = await mux.spawn({
      name: `quorum-planner-${Date.now()}`,
      command: provider,
      args: provider === "codex" ? ["exec", "--json", "-"] : ["-p", "--output-format", "stream-json"],
      cwd: repoRoot,
      env: { FEEDBACK_LOOP_ACTIVE: "1" },
    });

    const prompt = `# Auto-Planning from Parliament CPS

## CPS (Context-Problem-Solution)
${latestCps}

## Track Name
${trackName}

## Instructions
You are the planner. The parliament has produced the above CPS through deliberation.

1. Read the CPS above (Phase 0 — CPS Intake)
2. Generate a PRD from CPS: Context→§1, Problem→§2, Solution→§4
3. Generate Work Breakdown with WB IDs (e.g., ${trackName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3)}-1, ${trackName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3)}-2, ...)
4. Write to: ${planningDir}/${trackName}/work-breakdown.md
5. Include: ## WB-ID Title, First touch files (backtick-quoted), Prerequisites

${plannerProtocol}`;

    mux.send(session.id, prompt);

    // Poll for completion (3 min timeout)
    const timeout = 180_000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 5000));
      const cap = mux.capture(session.id, 200);
      if (!cap) continue;
      if (cap.output.includes('"type":"result"') || cap.output.includes('"stop_reason"') || cap.output.includes('"type":"turn.completed"')) {
        break;
      }
    }

    await mux.kill(session.id);
    await mux.cleanup();

    // Check if WBs were actually created
    const wbPath = resolve(planningDir, trackName, "work-breakdown.md");
    if (existsSync(wbPath)) {
      console.log(`  \x1b[32m✓ WBs generated:\x1b[0m ${wbPath}\n`);
      return true;
    }

    // Also check for files matching the track name
    const newTracks = findTracks(repoRoot);
    if (newTracks.some(t => t.name === trackName)) {
      console.log(`  \x1b[32m✓ Track found after planning\x1b[0m\n`);
      return true;
    }

    console.log("  \x1b[33mPlanner completed but WBs not found on disk.\x1b[0m\n");
    return false;
  } catch (err) {
    console.log(`  \x1b[31mPlanner failed: ${(err as Error).message}\x1b[0m\n`);
    await mux.cleanup();
    return false;
  }
}

// ── Auto-retro (release session gate) ───────

async function autoRetro(repoRoot: string): Promise<void> {
  const markerPath = resolve(repoRoot, ".session-state", "retro-marker.json");

  if (existsSync(markerPath)) {
    try {
      const { rmSync: rm } = await import("node:fs");
      rm(markerPath);
      console.log("  \x1b[32m✓ Retro marker cleared — session gate released.\x1b[0m");
    } catch (err) {
      console.log(`  \x1b[33m⚠ Could not clear retro marker: ${(err as Error).message}\x1b[0m`);
    }
  } else {
    console.log("  \x1b[2mNo retro marker (gate already open).\x1b[0m");
  }

  // Emit retro complete event
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
    if (bridge?.emitEvent) {
      bridge.emitEvent("retro.complete", "claude-code", { auto: true, timestamp: Date.now() });
    }
  } catch { /* non-critical */ }
}

// ── Auto-merge (if in worktree) ─────────────

async function autoMerge(repoRoot: string, bridge: Record<string, Function> | null): Promise<void> {
  const { spawnSync } = await import("node:child_process");

  // Detect if we're in a worktree
  const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
    cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });

  const isWorktree = gitDir.stdout?.includes("/worktrees/") || gitDir.stdout?.includes("\\worktrees\\");

  if (!isWorktree) {
    console.log("  \x1b[2mNot in worktree — skip auto-merge. Run: quorum merge <branch>\x1b[0m\n");
    return;
  }

  // Get current branch
  const branchResult = spawnSync("git", ["branch", "--show-current"], {
    cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  const branch = branchResult.stdout?.trim();

  if (!branch) {
    console.log("  \x1b[33m⚠ Could not detect current branch for auto-merge.\x1b[0m\n");
    return;
  }

  // Parliament gates check
  if (bridge?.checkParliamentGates) {
    const gate = bridge.checkParliamentGates();
    if (!gate.allowed) {
      console.log(`  \x1b[33m⚠ Merge blocked by parliament gate: ${gate.reason}\x1b[0m\n`);
      return;
    }
  }

  console.log(`  \x1b[36mAuto-merge: ${branch} → main\x1b[0m`);

  // Switch to main, merge, switch back
  const merge = spawnSync("git", ["merge", "--squash", branch], {
    cwd: repoRoot, encoding: "utf8", stdio: "inherit", windowsHide: true,
  });

  if (merge.status === 0) {
    console.log("  \x1b[32m✓ Squash merge staged. Review and commit.\x1b[0m\n");
  } else {
    console.log("  \x1b[33m⚠ Merge had issues. Resolve manually.\x1b[0m\n");
  }
}

function buildImplementerPrompt(item: WorkItem, trackName: string, repoRoot: string): string {
  let protocol = "";
  try {
    const p = resolve(repoRoot, "agents", "knowledge", "implementer-protocol.md");
    if (existsSync(p)) protocol = readFileSync(p, "utf8");
  } catch { /* ok */ }

  const files = item.targetFiles.length > 0
    ? item.targetFiles.map(f => `- ${f}`).join("\n")
    : "Identify targets from context.";

  return `# Task: ${item.id} (Track: ${trackName})

## Target Files
${files}

${item.dependsOn ? `## Dependencies: ${item.dependsOn.join(", ")}` : ""}

## Instructions
Implement this work breakdown item. Follow the implementer protocol.
After implementation, submit evidence with [REVIEW_NEEDED] tag.

${protocol}`;
}

function showHelp(): void {
  console.log(`
\x1b[36mquorum orchestrate\x1b[0m — session orchestration

\x1b[1mUsage:\x1b[0m quorum orchestrate [subcommand]

\x1b[1mSubcommands:\x1b[0m
  start [track]              Select and orchestrate a track (interactive)
  run <track> [--provider]   Execute WBs via agents (full implementation loop)
  assign <track> [--agent]   Assign track to an agent
  progress                   Show orchestration progress

\x1b[1mExamples:\x1b[0m
  quorum orchestrate                              Interactive track selection
  quorum orchestrate run my-track --provider claude   Execute all WBs
  quorum orchestrate assign my-track --agent impl-1
  quorum orchestrate progress
`);
}
