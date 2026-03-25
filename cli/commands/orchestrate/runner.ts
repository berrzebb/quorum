/**
 * Implementation loop — spawn agents, poll for verdicts, handle corrections.
 *
 * Responsible for: WB execution groups → agent spawn → audit polling →
 * correction rounds → track completion.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Bridge, type WorkItem, type WBSize, DIST, loadBridge, findTracks, parseWorkBreakdown, resolveTrack, reviewPlan } from "./shared.js";
import { autoGenerateWBs } from "./planner.js";
import { autoRetro, autoMerge } from "./lifecycle.js";

export async function runImplementationLoop(repoRoot: string, args: string[]): Promise<void> {
  const providerIdx = args.indexOf("--provider");
  const provider = providerIdx >= 0 ? args[providerIdx + 1] ?? "claude" : "claude";
  const providerValue = providerIdx >= 0 ? args[providerIdx + 1] : undefined;
  const trackInput = args.find(a => !a.startsWith("--") && a !== providerValue);
  const maxRetries = 3;

  const resolved = resolveTrack(trackInput, repoRoot);
  if (!resolved) {
    const tracks = findTracks(repoRoot);
    if (tracks.length === 0) {
      console.log("  No tracks found. Run 'quorum orchestrate plan <name>' first.\n");
    } else {
      console.log("  Usage: quorum orchestrate run [track] [--provider claude|codex|gemini]");
      console.log("  Available tracks:");
      for (let i = 0; i < tracks.length; i++) {
        console.log(`    ${i + 1}. ${tracks[i]!.name} (${tracks[i]!.items} items)`);
      }
      console.log();
    }
    return;
  }

  const trackName = resolved.name;

  console.log(`\n\x1b[36mquorum orchestrate run\x1b[0m — implementation loop\n`);
  console.log(`  Track:    ${trackName}`);
  console.log(`  Provider: ${provider}\n`);

  let tracks = findTracks(repoRoot);
  let track: typeof tracks[0] | undefined = resolved;

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

  // ── Plan Review Gate ──────────────────────────
  const review = reviewPlan(workItems);
  if (review.warnings.length > 0) {
    console.log("  \x1b[33mPlan warnings:\x1b[0m");
    for (const w of review.warnings) console.log(`    ⚠ ${w}`);
  }
  if (!review.passed) {
    console.log("  \x1b[31mPlan review FAILED:\x1b[0m");
    for (const e of review.errors) console.log(`    ✗ ${e}`);
    console.log("\n  Fix the work breakdown and re-run. WBs need Action + Verify fields.\n");
    return;
  }
  console.log(`  \x1b[32m✓ Plan review passed\x1b[0m (${workItems.length} items)\n`);

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

    const active: Array<{ item: WorkItem; sessionId: string; retries: number; outputFile?: string }> = [];

    // Build and store agent roster for this group
    const roster = group.items.map(item => ({
      agentId: `impl-${item.id}`,
      wbId: item.id,
      targetFiles: item.targetFiles,
      dependsOn: item.dependsOn ?? [],
    }));
    if (bridge?.setState) {
      bridge.setState(`agent:roster:${trackName}`, {
        trackName, groupIndex: gi, agents: roster, startedAt: Date.now(),
      });
    }

    // Prepare temp dir for prompt files + output files
    const isWin = process.platform === "win32";
    const tmpDir = resolve(repoRoot, ".claude", "agents", "tmp");
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    for (const item of group.items) {
      if (bridge?.claimFiles && item.targetFiles.length > 0) {
        bridge.claimFiles(`impl-${item.id}`, item.targetFiles, undefined, 1800_000);
      }

      try {
        const sessionName = `quorum-impl-${item.id}-${Date.now()}`;
        const promptFile = resolve(tmpDir, `${sessionName}.prompt.txt`);
        const outputFile = resolve(tmpDir, `${sessionName}.out`);
        const scriptFile = resolve(tmpDir, `${sessionName}${isWin ? ".cmd" : ".sh"}`);
        const prompt = buildImplementerPrompt(item, trackName, repoRoot, roster);

        // Write prompt to file for reliable stdin piping
        writeFileSync(promptFile, prompt, "utf8");

        // Model tier routing: XS→haiku, S→sonnet, M→opus
        const tier = selectModelForSize(provider, item.size);
        const modelFlag = tier.model ? ` --model ${tier.model}` : "";
        const cliFlags = tier.provider === "codex"
          ? "exec --json --full-auto -"
          : `-p --output-format stream-json --dangerously-skip-permissions${modelFlag}`;
        const escapedPrompt = promptFile.replace(/\\/g, "\\\\");
        const escapedOutput = outputFile.replace(/\\/g, "\\\\");

        if (isWin) {
          writeFileSync(scriptFile, `@type "${escapedPrompt}" | ${tier.provider} ${cliFlags} > "${escapedOutput}" 2>&1\n`, "utf8");
        } else {
          writeFileSync(scriptFile, `#!/bin/sh\ncat "${escapedPrompt}" | ${tier.provider} ${cliFlags} > "${escapedOutput}" 2>&1\n`, { mode: 0o755 });
        }

        // Spawn default shell in mux, then execute script
        const session = await mux.spawn({
          name: sessionName,
          cwd: repoRoot,
          env: { FEEDBACK_LOOP_ACTIVE: "1" },
        });

        // Small delay for shell to initialize
        await new Promise(r => setTimeout(r, 1000));
        mux.send(session.id, isWin ? `& "${scriptFile}"` : `"${scriptFile}"`);

        active.push({ item, sessionId: session.id, retries: 0, outputFile });
        saveAgentState(repoRoot, session.id, session.name, mux.getBackend(), item.id, trackName, outputFile);
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

        // Read from output file (reliable) or fall back to capture-pane
        let pollOutput = "";
        if (s.outputFile && existsSync(s.outputFile)) {
          try { pollOutput = readFileSync(s.outputFile, "utf8"); } catch { /* ok */ }
        }
        if (!pollOutput) {
          const cap = mux.capture(s.sessionId, 200);
          if (!cap) continue;
          pollOutput = cap.output;
        }
        if (!pollOutput) continue;

        // Must check for final result marker, NOT intermediate "stop_reason" (appears in every delta)
        const done = pollOutput.includes('"type":"result","subtype":"success"')
          || pollOutput.includes('"type":"turn.completed"');

        if (!done) continue;

        // Agent completed — check for audit verdict (may not exist if hooks didn't trigger)
        const verdicts = bridge?.queryEvents?.({ eventType: "audit.verdict" }) ?? [];
        const wbVerdicts = verdicts.filter((v: { timestamp?: number }) => {
          const ts = v.timestamp ?? 0;
          return ts > ((s as any).startedAt || 0);
        });
        const latest = wbVerdicts.length > 0 ? wbVerdicts[wbVerdicts.length - 1] : null;
        const verdict = latest?.payload?.verdict as string | undefined;

        if (verdict === "changes_requested" && s.retries < maxRetries) {
          s.retries++;
          console.log(`    \x1b[33m↻\x1b[0m ${s.item.id} correction ${s.retries}/${maxRetries}`);
          mux.send(s.sessionId, "Your submission was rejected. Check: quorum tool audit_history --summary --json\nFix issues and resubmit evidence with [REVIEW_NEEDED].");
        } else {
          // Agent done: approved, no verdict (hooks didn't fire), or max retries
          const label = verdict === "approved" ? "approved" : verdict === "changes_requested" ? `rejected (${s.retries}/${maxRetries})` : "done";
          const color = verdict === "changes_requested" ? "\x1b[33m" : "\x1b[32m";
          console.log(`    ${color}✓\x1b[0m ${s.item.id} ${label}`);
          completedWBs++;
          active.splice(si, 1);
          removeAgentState(repoRoot, s.sessionId);
          try { await mux.kill(s.sessionId); } catch { /* ok */ }
          if (bridge?.emitEvent) {
            bridge.emitEvent("track.progress", "generic", {
              trackId: trackName, completed: completedWBs, pending: active.length, total: totalWBs, blocked: 0,
            });
          }
        }
      }

      const pct = totalWBs > 0 ? Math.round((completedWBs / totalWBs) * 100) : 0;
      const sec = Math.round((Date.now() - start) / 1000);
      process.stdout.write(`\r    [${completedWBs}/${totalWBs}] ${pct}% ${sec}s ${active.length} active    `);
    }

    console.log();

    for (const s of active) {
      removeAgentState(repoRoot, s.sessionId);
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

// ── Agent state persistence for daemon ──────

function saveAgentState(repoRoot: string, sessionId: string, sessionName: string, backend: string, itemId: string, trackName: string, outputFile?: string): void {
  const dir = resolve(repoRoot, ".claude", "agents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${sessionId}.json`), JSON.stringify({
    id: sessionId, name: sessionName, backend,
    role: "implementer", type: "orchestrate",
    trackName, wbId: itemId,
    startedAt: Date.now(), status: "running",
    ...(outputFile ? { outputFile } : {}),
  }, null, 2), "utf8");
}

function removeAgentState(repoRoot: string, sessionId: string): void {
  try { rmSync(resolve(repoRoot, ".claude", "agents", `${sessionId}.json`), { force: true }); } catch { /* ok */ }
}

// ── Model Tier Routing ──────────────────────────

/**
 * Select model tier based on WB size.
 * XS → haiku (fast, cheap), S → sonnet (balanced), M → opus (full power).
 * Only applies to Claude provider; other providers use single model.
 */
function selectModelForSize(baseProvider: string, size?: WBSize): { provider: string; model?: string } {
  if (baseProvider !== "claude") return { provider: baseProvider };
  switch (size) {
    case "XS": return { provider: "claude", model: "haiku" };
    case "S":  return { provider: "claude", model: "sonnet" };
    case "M":  return { provider: "claude", model: "opus" };
    default:   return { provider: "claude" }; // no size → default model
  }
}

function buildImplementerPrompt(
  item: WorkItem, trackName: string, repoRoot: string,
  roster?: Array<{ agentId: string; wbId: string; targetFiles: string[]; dependsOn: string[] }>,
): string {
  let protocol = "";
  try {
    const p = resolve(repoRoot, "agents", "knowledge", "implementer-protocol.md");
    if (existsSync(p)) protocol = readFileSync(p, "utf8");
  } catch { /* ok */ }

  const files = item.targetFiles.length > 0
    ? item.targetFiles.map(f => `- ${f}`).join("\n")
    : "Identify targets from context.";

  // Peer agents in the same execution group
  const peers = (roster ?? [])
    .filter(r => r.agentId !== `impl-${item.id}`)
    .map(r => `- ${r.agentId}: ${r.wbId} (files: ${r.targetFiles.join(", ") || "TBD"})`)
    .join("\n");

  const commSection = peers ? `
## Active Peers
${peers}

## Inter-Agent Communication
Use \`quorum tool agent_comm\` to coordinate with peers:
- Ask: \`--action post --agent_id impl-${item.id} --to_agent <peer> --question "..."\`
- Check inbox: \`--action poll --agent_id impl-${item.id}\`
- Respond: \`--action respond --agent_id impl-${item.id} --query_id <id> --answer "..."\`
- Get answers: \`--action responses --agent_id impl-${item.id} --query_id <id>\`
Do NOT block waiting. Post query → continue working → check later.
` : "";

  // Action / Context Budget / Verify / Constraints — from WB schema
  const actionSection = item.action
    ? `## Action\n${item.action}`
    : "";
  const ctxSection = item.contextBudget
    ? `## Context Budget\n- **Read first**: ${item.contextBudget.read.map(f => `\`${f}\``).join(", ") || "none specified"}\n- **Do NOT explore**: ${item.contextBudget.skip.join(", ") || "none"}\nUse \`code_map\`/\`blast_radius\` for anything outside this list.`
    : "";
  const verifySection = item.verify
    ? `## Verify\nRun this BEFORE submitting evidence:\n\`\`\`bash\n${item.verify}\n\`\`\``
    : "";
  const constraintSection = item.constraints
    ? `## Constraints\n${item.constraints}`
    : "";

  return `# Task: ${item.id} (Track: ${trackName})

## Target Files
${files}

${item.dependsOn ? `## Dependencies: ${item.dependsOn.join(", ")}` : ""}
${actionSection}
${ctxSection}
${constraintSection}
${verifySection}
${commSection}
## Instructions
Implement this work breakdown item. Follow the implementer protocol.
After implementation, submit evidence with [REVIEW_NEEDED] tag.

${protocol}`;
}
