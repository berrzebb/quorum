/**
 * Implementation loop — spawn agents, poll for verdicts, handle corrections.
 *
 * Responsible for: WB execution groups → agent spawn → audit polling →
 * correction rounds → track completion.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { type Bridge, type WorkItem, type Wave, type WBSize, DIST, loadBridge, findTracks, parseWorkBreakdown, resolveTrack, reviewPlan, verifyDesignDiagrams, computeWaves } from "./shared.js";
import { autoGenerateWBs, autoFixDesignDiagrams } from "./planner.js";
import { autoRetro, autoMerge } from "./lifecycle.js";

// ── Wave State Persistence ────────────────────
interface WaveState {
  trackName: string;
  completedIds: string[];
  failedIds: string[];
  /** Wave index that was last fully completed (audit passed) */
  lastCompletedWave: number;
  updatedAt: string;
}

function waveStatePath(repoRoot: string, trackName: string): string {
  return resolve(repoRoot, ".claude", "quorum", `wave-state-${trackName}.json`);
}

function saveWaveState(repoRoot: string, state: WaveState): void {
  const dir = resolve(repoRoot, ".claude", "quorum");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeFileSync(waveStatePath(repoRoot, state.trackName), JSON.stringify(state, null, 2), "utf8");
}

function loadWaveState(repoRoot: string, trackName: string): WaveState | null {
  const p = waveStatePath(repoRoot, trackName);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    if (data.trackName !== trackName) return null;
    return data as WaveState;
  } catch { return null; }
}

export async function runImplementationLoop(repoRoot: string, args: string[]): Promise<void> {
  const providerIdx = args.indexOf("--provider");
  const provider = providerIdx >= 0 ? args[providerIdx + 1] ?? "claude" : "claude";
  const concurrencyIdx = args.indexOf("--concurrency");
  const maxConcurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1] ?? "3", 10) || 3 : 3;
  const resumeMode = args.includes("--resume");
  const providerValue = providerIdx >= 0 ? args[providerIdx + 1] : undefined;
  const concurrencyValue = concurrencyIdx >= 0 ? args[concurrencyIdx + 1] : undefined;
  const trackInput = args.find(a => !a.startsWith("--") && a !== providerValue && a !== concurrencyValue);
  const maxRetries = 3;

  const resolved = resolveTrack(trackInput, repoRoot);
  if (!resolved) {
    const tracks = findTracks(repoRoot);
    if (tracks.length === 0) {
      console.log("  No tracks found. Run 'quorum orchestrate plan <name>' first.\n");
    } else {
      console.log("  Usage: quorum orchestrate run [track] [--provider claude|codex|gemini|ollama|vllm]");
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
  console.log(`  Track:       ${trackName}`);
  console.log(`  Provider:    ${provider}`);
  console.log(`  Concurrency: ${maxConcurrency}`);
  if (resumeMode) console.log(`  Mode:        \x1b[33mresume\x1b[0m`);
  console.log();

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

  const allItems = parseWorkBreakdown(track.path);
  if (allItems.length === 0) {
    console.log("  \x1b[33mNo parseable work items.\x1b[0m\n");
    return;
  }

  // Separate parents from executable children
  // Parents are feature-level groupings — only children are executable
  const parentItems = allItems.filter(i => i.isParent);
  const workItems = allItems.filter(i => !i.isParent);
  const hasHierarchy = parentItems.length > 0;

  if (hasHierarchy) {
    console.log(`  \x1b[36mHierarchy:\x1b[0m ${parentItems.length} parent(s), ${workItems.length} child task(s)\n`);
  }

  // ── Plan Review Gate ──────────────────────────
  const review = reviewPlan(allItems);
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
  console.log(`  \x1b[32m✓ Plan review passed\x1b[0m (${workItems.length} executable items)\n`);

  // ── Design Document Gate ───────────────────────
  const designDir = resolve(dirname(track.path), "design");
  let designViolations = verifyDesignDiagrams(designDir);
  if (designViolations.length > 0) {
    console.log("  \x1b[33mDesign gate — missing diagrams, auto-fixing...\x1b[0m");
    for (const v of designViolations) console.log(`    ✗ ${v}`);

    const fixed = await autoFixDesignDiagrams(repoRoot, designDir, designViolations, provider);
    if (!fixed) {
      console.log("\n  \x1b[31mDesign auto-fix failed.\x1b[0m Run /quorum:mermaid manually.\n");
      return;
    }

    // Re-verify after auto-fix
    designViolations = verifyDesignDiagrams(designDir);
    if (designViolations.length > 0) {
      console.log("  \x1b[31mDesign gate still FAILED after auto-fix:\x1b[0m");
      for (const v of designViolations) console.log(`    ✗ ${v}`);
      return;
    }
  }
  if (existsSync(designDir)) console.log("  \x1b[32m✓ Design docs verified\x1b[0m\n");

  // ── RTM Checkpoint ─────────────────────────────
  // Generate skeletal RTM from WBs before implementation.
  // Scout protocol requires RTM to exist before execution for traceability.
  const rtmDir = dirname(track.path);
  const rtmPath = resolve(rtmDir, "rtm.md");
  if (!existsSync(rtmPath)) {
    console.log("  \x1b[36mGenerating RTM from work breakdown...\x1b[0m");
    const rtmContent = generateSkeletalRTM(workItems, track.name);
    if (!existsSync(rtmDir)) mkdirSync(rtmDir, { recursive: true });
    writeFileSync(rtmPath, rtmContent, "utf8");
    console.log(`  \x1b[32m✓ RTM generated\x1b[0m (${rtmPath})\n`);
  } else {
    console.log(`  \x1b[32m✓ RTM exists\x1b[0m (${rtmPath})\n`);
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

  // Contract file auto-protection: claim types/ directories so parallel agents can't modify
  if (bridge?.claimFiles) {
    const contractGlobs = ["**/types/**/*.ts", "**/contracts/**/*.ts", "**/interfaces/**/*.ts"];
    try {
      const { globSync } = await import("node:fs");
      // Use simple walk to find contract files
      const contractFiles: string[] = [];
      const walkForContracts = (dir: string, depth = 0): void => {
        if (depth > 5) return;
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
            const full = resolve(dir, e.name);
            if (e.isDirectory()) {
              if (e.name === "types" || e.name === "contracts" || e.name === "interfaces") {
                // Claim entire directory's .ts files
                const tsFiles = walkTsFiles(full);
                contractFiles.push(...tsFiles);
              } else {
                walkForContracts(full, depth + 1);
              }
            }
          }
        } catch { /* permission error */ }
      };
      const walkTsFiles = (dir: string): string[] => {
        const results: string[] = [];
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = resolve(dir, e.name);
            if (e.isDirectory()) results.push(...walkTsFiles(full));
            else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) results.push(full);
          }
        } catch { /* ok */ }
        return results;
      };
      walkForContracts(repoRoot);

      if (contractFiles.length > 0) {
        const conflicts = bridge.claimFiles("contract-guardian", contractFiles, undefined, 3600_000);
        if (conflicts.length > 0) {
          console.log(`  \x1b[33m⚠ ${conflicts.length} contract file(s) held by other agents\x1b[0m`);
        } else {
          console.log(`  \x1b[36m🔒 ${contractFiles.length} contract file(s) protected\x1b[0m`);
        }
      }
    } catch { /* fail-open: contract protection is best-effort */ }
  }

  // Wave-based execution grouping (dependency-aware topological sort)
  const waves = computeWaves(allItems);
  console.log(`  Waves: ${waves.length} (Phase gates → topological depth)\n`);

  // ── Resume state ─────────────────────────────
  let resumeState: WaveState | null = null;
  let skipUntilWave = -1;
  if (resumeMode) {
    resumeState = loadWaveState(repoRoot, trackName);
    if (resumeState) {
      skipUntilWave = resumeState.lastCompletedWave;
      console.log(`  \x1b[33m↻ Resuming from Wave ${skipUntilWave + 2}\x1b[0m (${resumeState.completedIds.length} completed, ${resumeState.failedIds.length} failed)`);
      if (resumeState.failedIds.length > 0) {
        console.log(`    Failed items to retry: ${resumeState.failedIds.join(", ")}`);
      }
      console.log();
    } else {
      console.log("  \x1b[33mNo saved state — starting from Wave 1\x1b[0m\n");
    }
  }

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
  let failedWBs = 0;
  let unverifiedWBs = 0;
  const totalWBs = workItems.length;

  // Track completed item IDs (for intra-group dependency resolution + parent tracking)
  const completedIds = new Set<string>();

  // Restore completed IDs from resume state
  if (resumeState) {
    for (const id of resumeState.completedIds) {
      completedIds.add(id);
      completedWBs++;
    }
    // Failed items are NOT added to completedIds — they will be retried
  }

  // Parent status tracking: parentId → { total children, completed child IDs }
  const parentChildStatus = new Map<string, { total: number; completed: Set<string> }>();
  if (hasHierarchy) {
    for (const parent of parentItems) {
      const children = workItems.filter(c => c.parentId === parent.id);
      parentChildStatus.set(parent.id, { total: children.length, completed: new Set() });
    }
  }

  for (let gi = 0; gi < waves.length; gi++) {
    const wave = waves[gi]!;

    // ── Resume: skip completed waves ──────────
    if (resumeMode && gi <= skipUntilWave) {
      // Check if ALL items in this wave are already completed
      const allDone = wave.items.every(i => completedIds.has(i.id));
      if (allDone) {
        console.log(`  \x1b[2mWave ${wave.index + 1}/${waves.length} — skipped (completed)\x1b[0m`);
        // Update parent tracking for skipped waves
        for (const item of wave.items) {
          if (hasHierarchy && item.parentId) {
            const ps = parentChildStatus.get(item.parentId);
            if (ps) ps.completed.add(item.id);
          }
        }
        continue;
      }
      // Wave has failed items — filter to only re-run those
      const failedInWave = wave.items.filter(i => !completedIds.has(i.id));
      if (failedInWave.length < wave.items.length) {
        console.log(`  \x1b[33mWave ${wave.index + 1}/${waves.length} — partial retry (${failedInWave.length} failed)\x1b[0m`);
        wave.items = failedInWave;
      }
    }

    const phaseLabel = wave.phaseId ? ` \x1b[2m(${wave.phaseId})\x1b[0m` : "";
    console.log(`  \x1b[1mWave ${wave.index + 1}/${waves.length}\x1b[0m (${wave.items.length} items)${phaseLabel}\n`);

    const active: Array<{ item: WorkItem; sessionId: string; retries: number; outputFile?: string }> = [];

    // Build and store agent roster for this wave
    const roster = wave.items.map(item => ({
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

    // ── Intra-wave dependency sequencing ─────────
    // Items whose dependsOn references items in the SAME wave must wait.
    // Only spawn items whose intra-wave deps are already completed.
    const groupIds = new Set(wave.items.map(i => i.id));
    const spawned = new Set<string>();

    /** Check if an item's intra-group dependencies are all resolved */
    const canSpawn = (item: WorkItem): boolean => {
      for (const dep of item.dependsOn ?? []) {
        if (groupIds.has(dep) && !completedIds.has(dep)) return false;
      }
      return true;
    };

    /** Spawn a single item into a mux session */
    const spawnItem = async (item: WorkItem): Promise<void> => {
      if (bridge?.claimFiles && item.targetFiles.length > 0) {
        bridge.claimFiles(`impl-${item.id}`, item.targetFiles, undefined, 1800_000);
      }

      try {
        const sessionName = `quorum-impl-${item.id}-${Date.now()}`;
        const promptFile = resolve(tmpDir, `${sessionName}.prompt.txt`);
        const outputFile = resolve(tmpDir, `${sessionName}.out`);
        const scriptFile = resolve(tmpDir, `${sessionName}${isWin ? ".cmd" : ".sh"}`);
        const prompt = buildImplementerPrompt(item, trackName, repoRoot, roster);

        writeFileSync(promptFile, prompt, "utf8");

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

        const session = await mux.spawn({
          name: sessionName,
          cwd: repoRoot,
          env: { FEEDBACK_LOOP_ACTIVE: "1" },
        });

        await new Promise(r => setTimeout(r, 1000));
        mux.send(session.id, isWin ? `& "${scriptFile}"` : `"${scriptFile}"`);

        active.push({ item, sessionId: session.id, retries: 0, outputFile });
        spawned.add(item.id);
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
        spawned.add(item.id); // mark as spawned to avoid infinite retry
      }
    };

    // Initial spawn: only items whose intra-wave deps are met AND under concurrency limit
    for (const item of wave.items) {
      if (active.length >= maxConcurrency) break;
      if (canSpawn(item)) {
        await spawnItem(item);
      }
    }

    const blocked = wave.items.filter(i => !spawned.has(i.id));
    if (blocked.length > 0) {
      console.log(`    \x1b[2m${blocked.length} item(s) waiting on intra-group dependencies\x1b[0m`);
    }

    // Poll loop
    const POLL = 5000;
    const TIMEOUT = 600_000;
    const start = Date.now();

    while ((active.length > 0 || spawned.size < wave.items.length) && Date.now() - start < TIMEOUT) {
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

        // Agent session completed — mark done (audit happens at Wave level, not per-agent)
        console.log(`    \x1b[32m✓\x1b[0m ${s.item.id} done`);
        completedWBs++;
        completedIds.add(s.item.id);
        active.splice(si, 1);
        removeAgentState(repoRoot, s.sessionId);
        try { await mux.kill(s.sessionId); } catch { /* ok */ }

        // Parent status tracking
        if (hasHierarchy && s.item.parentId) {
          const parentStatus = parentChildStatus.get(s.item.parentId);
          if (parentStatus) {
            parentStatus.completed.add(s.item.id);
            if (parentStatus.completed.size === parentStatus.total) {
              console.log(`    \x1b[36m◆\x1b[0m ${s.item.parentId} complete (${parentStatus.total}/${parentStatus.total})`);
            }
          }
        }

        if (bridge?.emitEvent) {
          bridge.emitEvent("track.progress", "generic", {
            trackId: trackName, completed: completedWBs, pending: active.length, total: totalWBs,
            blocked: 0, failed: failedWBs,
          });
        }
      }

      // Spawn newly unblocked items (intra-wave deps resolved, under concurrency limit)
      for (const item of wave.items) {
        if (active.length >= maxConcurrency) break;
        if (!spawned.has(item.id) && canSpawn(item)) {
          await spawnItem(item);
        }
      }

      const pct = totalWBs > 0 ? Math.round((completedWBs / totalWBs) * 100) : 0;
      const sec = Math.round((Date.now() - start) / 1000);
      const waitingCount = wave.items.filter(i => !spawned.has(i.id)).length;
      const waitingSuffix = waitingCount > 0 ? ` ${waitingCount} blocked` : "";
      process.stdout.write(`\r    [${completedWBs}/${totalWBs}] ${pct}% ${sec}s ${active.length} active${waitingSuffix}    `);
    }

    console.log();

    // Timeout cleanup: active items that didn't finish
    const timedOutIds: string[] = [];
    for (const s of active) {
      failedWBs++;
      timedOutIds.push(s.item.id);
      console.log(`    \x1b[31m✗\x1b[0m ${s.item.id} timed out`);
      removeAgentState(repoRoot, s.sessionId);
      try { await mux.kill(s.sessionId); } catch { /* ok */ }
    }
    for (const item of wave.items) {
      if (bridge?.releaseFiles) bridge.releaseFiles(`impl-${item.id}`);
    }

    // ── Wave-level Audit ─────────────────────────
    // All agents done → single audit for the wave's changes.
    // If audit fails → fixer agents target specific issues.
    const waveCompletedIds = wave.items.filter(i => completedIds.has(i.id));
    if (waveCompletedIds.length > 0) {
      const waveFiles = waveCompletedIds.flatMap(i => i.targetFiles);
      console.log(`\n  \x1b[36m◈ Wave ${wave.index + 1} audit\x1b[0m — ${waveCompletedIds.length} items, ${waveFiles.length} files`);

      let auditPassed = false;
      let fixAttempt = 0;

      while (!auditPassed) {
        fixAttempt++;

        // Run wave-level audit via CLI
        const auditResult = await runWaveAudit(repoRoot, waveFiles, waveCompletedIds, provider);

        if (auditResult.passed) {
          console.log(`  \x1b[32m✓ Wave ${wave.index + 1} audit passed\x1b[0m${fixAttempt > 1 ? ` (after ${fixAttempt - 1} fix round(s))` : ""}`);
          auditPassed = true;
        } else {
          console.log(`  \x1b[33m↻ Wave ${wave.index + 1} audit failed — spawning fixer (attempt ${fixAttempt})\x1b[0m`);
          for (const f of auditResult.findings) console.log(`    ✗ ${f}`);

          if (fixAttempt > maxRetries) {
            console.log(`  \x1b[31m✗ Wave ${wave.index + 1} audit failed after ${maxRetries} fix attempts\x1b[0m`);
            failedWBs += waveCompletedIds.length;
            break;
          }

          // Spawn fixer agent
          await runFixer(repoRoot, auditResult.findings, waveFiles, provider, mux);
        }
      }
    }

    // ── Save wave state for resume ──────────────
    saveWaveState(repoRoot, {
      trackName,
      completedIds: [...completedIds],
      failedIds: timedOutIds,
      lastCompletedWave: gi,
      updatedAt: "",
    });
  }

  // Release contract guardian claims
  if (bridge?.releaseFiles) bridge.releaseFiles("contract-guardian");

  // Summary
  console.log(`\n${"═".repeat(60)}\n`);
  console.log(`  \x1b[1mResult:\x1b[0m ${completedWBs}/${totalWBs} WBs approved`);
  if (failedWBs > 0) {
    console.log(`  \x1b[31m✗ ${failedWBs} item(s) FAILED — no evidence or rejected after max retries\x1b[0m`);
  }
  if (unverifiedWBs > 0) {
    console.log(`  \x1b[33m⧖ ${unverifiedWBs} item(s) awaiting audit verdict — run 'quorum audit'\x1b[0m`);
  }

  // Parent readiness summary
  if (hasHierarchy) {
    const readyParents = [...parentChildStatus.entries()].filter(([, s]) => s.completed.size === s.total);
    const pendingParents = [...parentChildStatus.entries()].filter(([, s]) => s.completed.size < s.total);
    if (readyParents.length > 0) {
      console.log(`  \x1b[36mParents ready:\x1b[0m ${readyParents.map(([id]) => id).join(", ")}`);
    }
    if (pendingParents.length > 0) {
      for (const [id, status] of pendingParents) {
        console.log(`  \x1b[33mParent ${id}:\x1b[0m ${status.completed.size}/${status.total} children done`);
      }
    }
  }

  if (completedWBs === totalWBs && failedWBs === 0 && unverifiedWBs === 0) {
    console.log("  \x1b[32m✓ Track complete!\x1b[0m\n");
    if (bridge?.emitEvent) {
      bridge.emitEvent("track.complete", "generic", { trackId: trackName, total: totalWBs });
    }
    console.log("  \x1b[36mAuto-retro...\x1b[0m");
    await autoRetro(repoRoot);
    await autoMerge(repoRoot, bridge);
  } else {
    const remaining = totalWBs - completedWBs;
    if (failedWBs > 0) {
      console.log(`  \x1b[31m${failedWBs} FAILED — agents exited without meeting completion criteria.\x1b[0m`);
      console.log(`  \x1b[31mTrack BLOCKED until failed items are re-run.\x1b[0m\n`);
    } else {
      console.log(`  \x1b[33m${remaining} incomplete. Run again or check progress.\x1b[0m\n`);
    }
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
When done, run the verify command to confirm your work is correct.

${protocol}`;
}

// ── Wave-level Audit ────────────────────────────

interface WaveAuditResult {
  passed: boolean;
  findings: string[];
}

/**
 * Run a single audit for all changes in a wave.
 * Uses `claude -p` with auditor instructions to review the wave's files.
 */
async function runWaveAudit(
  repoRoot: string, files: string[], items: WorkItem[], provider: string,
): Promise<WaveAuditResult> {
  const { spawnSync } = await import("node:child_process");
  const quorumRoot = resolve(DIST, "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  const fileList = [...new Set(files)].slice(0, 20).map(f => `- ${f}`).join("\n");
  const itemList = items.map(i => `- ${i.id}: ${i.title ?? "(no title)"}`).join("\n");

  const prompt = [
    "# Wave Audit — Review Implementation Changes",
    "",
    `## Items completed in this wave:`,
    itemList,
    "",
    `## Files to review:`,
    fileList,
    "",
    "## Instructions:",
    "1. Read each file listed above",
    "2. Check: does the code compile? Are types correct? Are there obvious bugs?",
    "3. Run the verify commands from the work breakdown if available",
    "4. Output a JSON verdict at the END of your response in this exact format:",
    '```json',
    '{"passed": true|false, "findings": ["issue 1", "issue 2"]}',
    '```',
    "",
    "If all items are correctly implemented with no compilation errors, output passed: true.",
    "If there are issues, list specific findings with file paths.",
  ].join("\n");

  const result = spawnSync(bin, ["-p", prompt, "--dangerously-skip-permissions"], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
    timeout: 180_000,
    encoding: "utf8",
  });

  const output = (result.stdout ?? "") as string;

  // Parse verdict from output
  const jsonMatch = output.match(/```json\s*\n({[\s\S]*?})\s*\n```/);
  if (jsonMatch) {
    try {
      const verdict = JSON.parse(jsonMatch[1]!);
      return {
        passed: !!verdict.passed,
        findings: Array.isArray(verdict.findings) ? verdict.findings : [],
      };
    } catch { /* fall through */ }
  }

  // If no structured verdict, check for pass/fail keywords
  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes('"passed": true') || lowerOutput.includes("all items are correctly")) {
    return { passed: true, findings: [] };
  }

  return { passed: false, findings: ["Audit returned unstructured output — manual review needed"] };
}

// ── Fixer Agent ─────────────────────────────────

/**
 * Spawn a fixer agent to address specific audit findings.
 * Fixer reads existing code + audit findings → applies targeted fixes.
 * Different from implementer: no fresh implementation, just bug fixing.
 */
async function runFixer(
  repoRoot: string, findings: string[], files: string[], provider: string, mux: any,
): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const quorumRoot = resolve(DIST, "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  const fileList = [...new Set(files)].slice(0, 15).map(f => `- ${f}`).join("\n");
  const findingList = findings.map(f => `- ${f}`).join("\n");

  const prompt = [
    "# Fixer — Address Audit Findings",
    "",
    "## Audit Findings (fix ALL of these):",
    findingList,
    "",
    "## Affected Files:",
    fileList,
    "",
    "## Instructions:",
    "1. Read each affected file",
    "2. Fix the specific issues listed in the findings",
    "3. Run compilation check (tsc --noEmit or equivalent)",
    "4. Do NOT rewrite or restructure — only fix the identified issues",
    "5. Run any available tests to verify your fixes",
  ].join("\n");

  console.log(`    \x1b[36m🔧 Fixer agent started\x1b[0m`);

  spawnSync(bin, ["-p", prompt, "--dangerously-skip-permissions"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
    timeout: 180_000,
  });

  console.log(`    \x1b[36m🔧 Fixer agent done\x1b[0m`);
}

// ── RTM Generation ──────────────────────────────

/**
 * Generate a skeletal RTM (Requirements Traceability Matrix) from WBs.
 * Pre-implementation: all rows are "pending". Post-implementation: Scout
 * updates status via forward/backward scan with code_map + dependency_graph.
 *
 * This ensures every WB has a traceable verification checklist BEFORE
 * any agent starts implementing.
 */
function generateSkeletalRTM(items: WorkItem[], trackName: string): string {
  const rows = items.map(item => {
    const files = item.targetFiles.length > 0 ? item.targetFiles.join(", ") : "TBD";
    const verify = item.verify ?? "not specified";
    const done = item.done ?? "not specified";
    return `| ${item.id} | ${item.title ?? item.id} | ${files} | ${verify} | ${done} | pending |`;
  });

  return `# RTM — ${trackName}

> Requirements Traceability Matrix (auto-generated from work breakdown)
> Status: pre-implementation. Run Scout after implementation to update.

## Forward Trace (Requirement → Code → Test)

| Req ID | Description | Target Files | Verify Command | Done Criteria | Status |
|--------|-------------|--------------|----------------|---------------|--------|
${rows.join("\n")}

## Backward Trace (Test → Requirement)

> Populated by Scout after implementation (code_map + dependency_graph scan).

| Test File | Covers Req | Import Chain | Status |
|-----------|------------|--------------|--------|
| _(run Scout to populate)_ | | | |

## Bidirectional Summary

- **Total requirements**: ${items.length}
- **Covered**: 0
- **Gaps**: ${items.length} (all pending — pre-implementation)
- **Orphan tests**: 0

## Gap Report

All ${items.length} requirements are pending implementation.
Priority order based on dependencies:
${items.filter(i => !i.dependsOn || i.dependsOn.length === 0).map(i => `- **${i.id}**: no dependencies (can start immediately)`).join("\n")}
${items.filter(i => i.dependsOn && i.dependsOn.length > 0).map(i => `- **${i.id}**: depends on ${i.dependsOn!.join(", ")}`).join("\n")}
`;
}
