/**
 * Implementation loop — spawn agents, poll for verdicts, handle corrections.
 *
 * Responsible for: WB execution groups → agent spawn → audit polling →
 * correction rounds → track completion.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Bridge, type WorkItem, DIST, loadBridge, findTracks, parseWorkBreakdown } from "./shared.js";
import { autoGenerateWBs } from "./planner.js";
import { autoRetro, autoMerge } from "./lifecycle.js";

export async function runImplementationLoop(repoRoot: string, args: string[]): Promise<void> {
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

  // Auto-plan if no WBs exist
  if (!track || parseWorkBreakdown(track.path).length === 0) {
    const generated = await autoGenerateWBs(repoRoot, trackName, provider);
    if (!generated) {
      console.log(`  \x1b[31mNo WBs for '${trackName}' and auto-generation failed.\x1b[0m\n`);
      return;
    }
    tracks = findTracks(repoRoot);
    track = tracks.find(t => t.name === trackName);
    if (!track) {
      console.log(`  \x1b[31mTrack still not found after planner.\x1b[0m\n`);
      return;
    }
  }

  const workItems = parseWorkBreakdown(track.path);
  if (workItems.length === 0) {
    console.log("  \x1b[33mNo parseable work items.\x1b[0m\n");
    return;
  }

  const bridge = await loadBridge(repoRoot);

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
  const toURL = (p: string) => pathToFileURL(p).href;
  let mux: any;
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
          bridge.emitEvent("agent.spawn", "generic", {
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
      bridge.emitEvent("track.complete", "generic", { trackId: trackName, total: totalWBs });
    }
    console.log("  \x1b[36mAuto-retro...\x1b[0m");
    await autoRetro(repoRoot);
    await autoMerge(repoRoot, bridge);
  } else {
    console.log(`  \x1b[33m${totalWBs - completedWBs} incomplete. Run again or check progress.\x1b[0m\n`);
  }

  await mux.cleanup();
  if (bridge?.close) bridge.close();
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
