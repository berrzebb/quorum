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
      showProgress(repoRoot);
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

  // Emit orchestration event
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
    await bridge.init(repoRoot);
    bridge.emitEvent("track.create", "claude-code", {
      trackId: track.name,
      total: track.items,
      completed: 0,
      pending: track.items,
      blocked: 0,
    });
    bridge.close();
  } catch { /* bridge non-critical */ }

  console.log("  Steps:");
  console.log("    1. \x1b[32m✓\x1b[0m Track selected");
  console.log("    2. Run scout for RTM:  quorum agent spawn scout claude -p \"scout ${track.name}\"");
  console.log("    3. Assign to agent:    quorum orchestrate assign ${track.name} <agent-name>");
  console.log("    4. Monitor progress:   quorum orchestrate progress");
  console.log("    5. After approval:     quorum retro");
  console.log("    6. Merge:              quorum merge\n");
}

async function assignTrack(repoRoot: string, trackName: string | undefined, args: string[]): Promise<void> {
  if (!trackName) {
    console.log("  Usage: quorum orchestrate assign <track> [--agent <name>]\n");
    return;
  }

  const agentName = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : `impl-${trackName}`;

  console.log(`\n  \x1b[36mAssigning ${trackName} → ${agentName}\x1b[0m\n`);
  console.log("  To spawn the agent:");
  console.log(`    quorum agent spawn ${agentName} claude -p "implement track ${trackName}"`);
  console.log(`    quorum agent spawn ${agentName} codex exec "implement track ${trackName}"\n`);
}

function showProgress(repoRoot: string): void {
  console.log("\n\x1b[36mquorum orchestrate progress\x1b[0m\n");

  // Read from EventStore if available
  try {
    const dbPath = resolve(repoRoot, ".claude", "quorum-events.db");
    if (!existsSync(dbPath)) {
      console.log("  No event data. Run 'quorum daemon' to start collecting.\n");
      return;
    }

    const toURL = (p: string) => pathToFileURL(p).href;
    // Synchronous import doesn't work here, but we can read the bridge
    console.log("  Run 'quorum daemon' for real-time progress view.");
    console.log("  Or:  quorum status\n");
  } catch {
    console.log("  Run 'quorum status' for current state.\n");
  }
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
