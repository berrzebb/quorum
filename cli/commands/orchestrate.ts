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

function showHelp(): void {
  console.log(`
\x1b[36mquorum orchestrate\x1b[0m — session orchestration

\x1b[1mUsage:\x1b[0m quorum orchestrate [subcommand]

\x1b[1mSubcommands:\x1b[0m
  start [track]              Select and orchestrate a track (interactive)
  assign <track> [--agent]   Assign track to an agent
  progress                   Show orchestration progress

\x1b[1mExamples:\x1b[0m
  quorum orchestrate                         Interactive track selection
  quorum orchestrate start evaluation-pipeline   Direct track selection
  quorum orchestrate assign tenant-runtime --agent impl-1
  quorum orchestrate progress
`);
}
