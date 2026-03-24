/**
 * quorum orchestrate — select tracks, distribute to agents, monitor progress.
 *
 * Thin dispatcher. Business logic lives in:
 *   orchestrate/shared.ts    — types, bridge loader, track/WB parsing
 *   orchestrate/planner.ts   — interactive planner (Socratic + CPS)
 *   orchestrate/runner.ts    — implementation loop (spawn → poll → retry)
 *   orchestrate/lifecycle.ts — auto-retro, auto-merge
 */

import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { type Bridge, loadBridge, findTracks, parseWorkBreakdown } from "./orchestrate/shared.js";
import { interactivePlanner } from "./orchestrate/planner.js";
import { runImplementationLoop } from "./orchestrate/runner.js";

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const subcommand = args[0] ?? "start";

  switch (subcommand) {
    case "start":
      await startOrchestration(repoRoot, args.slice(1));
      break;
    case "plan":
      await interactivePlanner(repoRoot, args.slice(1));
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

// ── Start (interactive track selection) ─────

async function startOrchestration(repoRoot: string, args: string[]): Promise<void> {
  console.log("\n\x1b[36mquorum orchestrate\x1b[0m — session orchestration\n");

  const tracks = findTracks(repoRoot);
  if (tracks.length === 0) {
    console.log("  No tracks found. Run 'quorum orchestrate plan <track>' first.\n");
    return;
  }

  console.log("  \x1b[1mAvailable tracks:\x1b[0m\n");
  for (let i = 0; i < tracks.length; i++) {
    console.log(`    ${i + 1}. ${tracks[i]!.name} (${tracks[i]!.items} items)`);
  }

  const targetTrack = args[0];
  if (targetTrack) {
    const track = tracks.find(t => t.name === targetTrack);
    if (!track) { console.log(`\n  Track '${targetTrack}' not found.\n`); return; }
    await orchestrateTrack(repoRoot, track);
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(r => rl.question("\n  Select track number (or 'q' to quit): ", r));
  rl.close();
  if (answer.trim().toLowerCase() === "q") return;

  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= tracks.length) { console.log("  Invalid selection.\n"); return; }
  await orchestrateTrack(repoRoot, tracks[idx]!);
}

async function orchestrateTrack(
  repoRoot: string,
  track: { name: string; path: string; items: number },
): Promise<void> {
  console.log(`\n  \x1b[1mOrchestrating: ${track.name}\x1b[0m (${track.items} items)\n`);

  const bridge = await loadBridge(repoRoot);
  const workItems = parseWorkBreakdown(track.path);

  if (bridge?.selectExecutionMode && workItems.length > 0) {
    const selection = bridge.selectExecutionMode(workItems);
    if (selection) {
      console.log(`  Mode: ${selection.mode}, Max concurrency: ${selection.maxConcurrency}`);
      if (selection.plan.groups.length > 0) {
        console.log(`\n  Execution groups (${selection.plan.depth} steps):\n`);
        for (const group of selection.plan.groups) {
          const ids = group.items.map((i: { id: string }) => i.id).join(", ");
          console.log(`    Step ${group.order + 1}: [${ids}]  (${group.items.length} parallel)`);
        }
      }
    }
  }

  if (bridge?.emitEvent) {
    bridge.emitEvent("track.create", "generic", {
      trackId: track.name, total: track.items, completed: 0, pending: track.items, blocked: 0,
    });
  }

  console.log("\n  \x1b[1mNext steps:\x1b[0m");
  console.log(`    quorum orchestrate plan ${track.name}    Interactive planning`);
  console.log(`    quorum orchestrate run ${track.name}     Full implementation loop\n`);

  if (bridge?.close) bridge.close();
}

// ── Assign ──────────────────────────────────

async function assignTrack(repoRoot: string, trackName: string | undefined, args: string[]): Promise<void> {
  if (!trackName) { console.log("  Usage: quorum orchestrate assign <track> [--agent <name>]\n"); return; }

  const agentName = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : `impl-${trackName}`;
  const tracks = findTracks(repoRoot);
  const track = tracks.find(t => t.name === trackName);
  const bridge = await loadBridge(repoRoot);

  if (bridge?.claimFiles && track) {
    const workItems = parseWorkBreakdown(track.path);
    const allFiles = workItems.flatMap(i => i.targetFiles);
    if (allFiles.length > 0) {
      const conflicts = bridge.claimFiles(agentName, allFiles, undefined, 600_000);
      if (conflicts.length > 0) {
        console.log(`\n  \x1b[31m✗ File conflicts:\x1b[0m`);
        for (const c of conflicts) console.log(`    ${c.filePath} → ${c.heldBy}`);
        if (bridge?.close) bridge.close();
        return;
      }
      console.log(`  \x1b[32m✓\x1b[0m Claimed ${allFiles.length} file(s) for ${agentName}`);
    }
  }

  if (bridge?.emitEvent) {
    bridge.emitEvent("agent.spawn", "generic", { agentId: agentName, role: "implementer", trackId: trackName });
  }

  console.log(`\n  \x1b[36mAssigned ${trackName} → ${agentName}\x1b[0m\n`);
  if (bridge?.close) bridge.close();
}

// ── Progress ────────────────────────────────

async function showProgress(repoRoot: string): Promise<void> {
  console.log("\n\x1b[36mquorum orchestrate progress\x1b[0m\n");

  const bridge = await loadBridge(repoRoot);

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
    }
  }

  if (bridge?.analyzeAuditLearnings) {
    const learnings = bridge.analyzeAuditLearnings();
    if (learnings?.patterns.length > 0) {
      console.log("  \x1b[1mRepeat patterns:\x1b[0m\n");
      for (const p of learnings.patterns.slice(0, 5)) {
        console.log(`    ${p.key} (${p.type}): ${p.count}×`);
      }
    }
  }

  console.log("  Run 'quorum daemon' for real-time TUI.\n");
  if (bridge?.close) bridge.close();
}

// ── Help ────────────────────────────────────

function showHelp(): void {
  console.log(`
\x1b[36mquorum orchestrate\x1b[0m — session orchestration

\x1b[1mSubcommands:\x1b[0m
  start [track]              Select and orchestrate a track
  plan <track> [--provider]  Interactive planner (Socratic + CPS)
  run <track> [--provider]   Execute WBs (full implementation loop)
  assign <track> [--agent]   Assign track to an agent
  progress                   Show orchestration progress

\x1b[1mExamples:\x1b[0m
  quorum orchestrate plan auth-track               Socratic planning session
  quorum orchestrate run payment-track --provider claude  Full execution
  quorum orchestrate assign my-track --agent impl-1
  quorum orchestrate progress
`);
}
