/** @module Compatibility shell — real implementation in orchestrate/execution/ and orchestrate/governance/ */

import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import {
  type Bridge, type WorkItem, type Wave, DIST,
  loadBridge, findTracks, parseWorkBreakdown, resolveTrack, reviewPlan,
  verifyDesignDiagrams, computeWaves,
} from "./shared.js";
import { autoGenerateWBs, autoFixDesignDiagrams } from "./planner.js";
import { autoRetro, autoMerge } from "../../../orchestrate/governance/lifecycle-hooks.js";
import { parseBlueprints, type NamingRule } from "../../../bus/blueprint-parser.js";

// ── Extracted module imports ─────────────────
import { runPreflightCheck, walkSourceFiles, type PreflightResult } from "../../../orchestrate/execution/preflight.js";
import { runWave, type WaveResult } from "../../../orchestrate/execution/wave-runner.js";
import { runWaveAuditLLM } from "../../../orchestrate/execution/wave-audit-llm.js";
import { captureSnapshot, recordWaveManifest, readPreviousManifests } from "../../../orchestrate/execution/snapshot.js";
import type { FitnessGateResult } from "../../../orchestrate/governance/fitness-gates.js";
import { verifyPhaseCompletion as _verifyPhaseCompletion } from "../../../orchestrate/governance/phase-gates.js";
import { generateSkeletalRTM } from "../../../orchestrate/governance/rtm-generator.js";
import { runE2EVerification } from "../../../orchestrate/governance/e2e-verification.js";

// State persistence
import { FilesystemCheckpointStore } from "../../../orchestrate/state/filesystem/checkpoint-store.js";
import type { WaveCheckpoint } from "../../../orchestrate/state/state-types.js";

// Contract control plane (PLT-6F)
import { InMemoryContractLedger } from "../../../core/harness/contract-ledger.js";
import { createSprintContract } from "../../../core/harness/sprint-contract.js";
import { createEvaluationContract } from "../../../core/harness/evaluation-contract.js";
import { createHandoffArtifact } from "../../../core/harness/handoff-artifact.js";
import { createNegotiationRecord } from "../../../core/harness/negotiation-record.js";
import { createIterationPolicy, shouldEscalate, isExhausted } from "../../../core/harness/iteration-policy.js";
import { approveWithNegotiation } from "../../../orchestrate/planning/contract-negotiation.js";
import { PromotionGate } from "../../../bus/promotion-gate.js";
import { HandoffGate } from "../../../bus/handoff-gate.js";

// ── CLI arg parsing ──────────────────────────

function parseRunArgs(args: string[]) {
  const opt = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const provider = opt("--provider") ?? "claude";
  // Auditor MUST differ from provider for meaningful review.
  // Default fallback order: gemini → codex → provider (last resort).
  const explicitAuditor = opt("--auditor");
  const auditor = explicitAuditor ?? _defaultAuditor(provider);
  const maxConcurrency = parseInt(opt("--concurrency") ?? "3", 10) || 3;
  const parliament = args.includes("--parliament");
  const verboseFitness = args.includes("--verbose-fitness");
  const fullGates = args.includes("--full-gates");
  const optValues = new Set([opt("--provider"), opt("--auditor"), opt("--concurrency")].filter(Boolean));
  const trackInput = args.find(a => !a.startsWith("--") && !optValues.has(a));
  return { provider, auditor, maxConcurrency, resumeMode: args.includes("--resume"), parliament, verboseFitness, fullGates, trackInput };
}

// ── Main entry point (CLI-specific presentation) ──

export async function runImplementationLoop(repoRoot: string, args: string[]): Promise<void> {
  const { provider, auditor, maxConcurrency, resumeMode, parliament, verboseFitness, fullGates, trackInput } = parseRunArgs(args);
  const maxRetries = 3;

  const resolved = resolveTrack(trackInput, repoRoot);
  if (!resolved) {
    const tracks = findTracks(repoRoot);
    if (tracks.length === 0) {
      console.log("  No tracks found. Run 'quorum orchestrate plan <name>' first.\n");
    } else {
      console.log("  Usage: quorum orchestrate run [track] [--provider claude|codex|gemini] [--auditor claude|codex|gemini]");
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
  const auditMode = parliament ? "parliament (3-role)" : "single";
  console.log(`  Track: ${trackName}  Provider: ${provider}  Auditor: ${auditor}  Audit: ${auditMode}  Concurrency: ${maxConcurrency}`);
  if (provider === auditor) {
    console.log(`  \x1b[33m⚠ Auditor = Provider (same model). Use --auditor <model> for cross-model review.\x1b[0m`);
  }
  if (resumeMode) console.log(`  Mode:  \x1b[33mresume\x1b[0m`);
  console.log();

  let tracks = findTracks(repoRoot);
  let track: typeof tracks[0] | undefined = resolved;
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
  if (allItems.length === 0) { console.log("  \x1b[33mNo parseable work items.\x1b[0m\n"); return; }

  const parentItems = allItems.filter(i => i.isParent);
  const workItems = allItems.filter(i => !i.isParent);
  const hasHierarchy = parentItems.length > 0;
  if (hasHierarchy) console.log(`  \x1b[36mHierarchy:\x1b[0m ${parentItems.length} parent(s), ${workItems.length} child task(s)\n`);

  const preflight = runPreflightCheck(repoRoot);
  if (preflight.errors.length > 0) {
    console.log("  \x1b[31mPre-flight FAILED:\x1b[0m");
    for (const e of preflight.errors) console.log(`    ✗ ${e}`);
    console.log("\n  Fix the issues above before running orchestrate.\n");
    return;
  }
  if (preflight.warnings.length > 0) {
    for (const w of preflight.warnings) console.log(`  \x1b[33m⚠ ${w}\x1b[0m`);
  }
  console.log(`  \x1b[32m✓ Pre-flight passed\x1b[0m${preflight.fitnessBaseline !== undefined ? ` (baseline fitness: ${preflight.fitnessBaseline.toFixed(2)})` : ""}\n`);
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
  const designDir = resolve(dirname(track.path), "design");
  let designViolations = verifyDesignDiagrams(designDir);
  if (designViolations.length > 0) {
    console.log("  \x1b[33mDesign gate — missing diagrams, auto-fixing...\x1b[0m");
    for (const v of designViolations) console.log(`    ✗ ${v}`);
    const fixed = await autoFixDesignDiagrams(repoRoot, designDir, designViolations, provider);
    if (!fixed) { console.log("\n  \x1b[31mDesign auto-fix failed.\x1b[0m Run /quorum:mermaid manually.\n"); return; }
    designViolations = verifyDesignDiagrams(designDir);
    if (designViolations.length > 0) {
      console.log("  \x1b[31mDesign gate still FAILED after auto-fix:\x1b[0m");
      for (const v of designViolations) console.log(`    ✗ ${v}`);
      return;
    }
  }
  if (existsSync(designDir)) console.log("  \x1b[32m✓ Design docs verified\x1b[0m\n");
  let blueprintRules: NamingRule[] = [];
  if (existsSync(designDir)) {
    try {
      const bp = parseBlueprints(designDir);
      blueprintRules = bp.rules;
      if (bp.rules.length > 0) {
        console.log(`  \x1b[36m✓ ${bp.rules.length} naming rule(s) loaded\x1b[0m from ${bp.sources.length} blueprint(s)\n`);
      }
    } catch (err) { console.warn(`[runner] blueprint parsing failed: ${(err as Error).message}`); }
  }
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
  if (bridge?.parliament?.checkParliamentGates) {
    const gate = bridge.parliament.checkParliamentGates();
    if (!gate.allowed) {
      console.log(`  \x1b[31mParliament gate:\x1b[0m ${gate.reason}\n`);
      if (bridge?.close) bridge.close();
      return;
    }
  }
  try { execSync(`git tag "quorum-baseline/${trackName}/${Date.now()}"`, { cwd: repoRoot, timeout: 5000, stdio: "pipe", windowsHide: true }); } catch (err) { console.warn(`[runner] git tag baseline failed: ${(err as Error).message}`); }
  claimContractFiles(repoRoot, bridge);

  // ── Contract Control Plane (PLT-6F) ─────────
  const contractLedger = new InMemoryContractLedger();
  const promotionGate = new PromotionGate(contractLedger);
  const handoffGate = new HandoffGate(contractLedger);
  const iterationPolicy = createIterationPolicy({ maxAttempts: maxRetries, escalationAt: 2, amendAfter: 3 });

  const waves = computeWaves(allItems);
  console.log(`  Waves: ${waves.length} (Phase gates → topological depth)\n`);
  const checkpointDir = resolve(repoRoot, ".claude", "quorum");
  const checkpointStore = new FilesystemCheckpointStore(checkpointDir);
  const resumeState = resumeMode ? checkpointStore.load(trackName) : null;
  const skipUntilWave = resumeState?.lastCompletedWave ?? -1;
  if (resumeMode) {
    if (resumeState) {
      console.log(`  \x1b[33m↻ Resuming from Wave ${skipUntilWave + 2}\x1b[0m (${resumeState.completedIds.length} completed, ${resumeState.failedIds.length} failed)`);
      if (resumeState.failedIds.length > 0) console.log(`    Failed items to retry: ${resumeState.failedIds.join(", ")}`);
    } else console.log("  \x1b[33mNo saved state — starting from Wave 1\x1b[0m");
    console.log();
  }
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
  let completedWBs = 0, failedWBs = 0, unverifiedWBs = 0;
  let consecutiveFailedWaves = 0;
  let lastFitnessResult: FitnessGateResult | undefined;
  const totalWBs = workItems.length;
  const completedIds = new Set<string>();
  if (resumeState) for (const id of resumeState.completedIds) { completedIds.add(id); completedWBs++; }
  const parentChildStatus = new Map<string, { total: number; completed: Set<string> }>();
  if (hasHierarchy) for (const p of parentItems) parentChildStatus.set(p.id, { total: workItems.filter(c => c.parentId === p.id).length, completed: new Set() });
  let currentPhaseId: string | undefined;
  for (let gi = 0; gi < waves.length; gi++) {
    const wave = waves[gi]!;
    if (resumeMode && gi <= skipUntilWave) {
      const allDone = wave.items.every(i => completedIds.has(i.id));
      if (allDone) {
        console.log(`  \x1b[2mWave ${wave.index + 1}/${waves.length} — skipped (completed)\x1b[0m`);
        for (const item of wave.items) {
          if (hasHierarchy && item.parentId) {
            const ps = parentChildStatus.get(item.parentId);
            if (ps) ps.completed.add(item.id);
          }
        }
        currentPhaseId = wave.phaseId ?? currentPhaseId;
        continue;
      }
      const failedInWave = wave.items.filter(i => !completedIds.has(i.id));
      if (failedInWave.length < wave.items.length) {
        console.log(`  \x1b[33mWave ${wave.index + 1}/${waves.length} — partial retry (${failedInWave.length} failed)\x1b[0m`);
        wave.items = failedInWave;
      }
    }
    if (wave.phaseId && currentPhaseId && wave.phaseId !== currentPhaseId) {
      const prevPhaseItems = waves
        .filter(w => w.phaseId === currentPhaseId)
        .flatMap(w => w.items);
      console.log(`\n  \x1b[36m◈ Phase gate\x1b[0m — verifying ${currentPhaseId} before ${wave.phaseId}`);

      // Store phase-level sprint + evaluation contracts (keys must match canPromote lookup)
      // Only bind promotion gate when fitness data exists (avoids undefined < threshold → false)
      const phaseContractId = `${trackName}/${currentPhaseId}`;
      const hasPromotionData = lastFitnessResult != null;
      if (hasPromotionData) {
        // Sprint contract required by PromotionGate.canPromote()
        const phaseSprintContract = createSprintContract({
          trackName,
          waveId: currentPhaseId,
          scope: prevPhaseItems.map(i => i.id),
          doneCriteria: prevPhaseItems.filter(i => i.done).map(i => i.done!),
          evidenceRequired: [],
          approvalState: "approved",
        });
        phaseSprintContract.contractId = phaseContractId;
        contractLedger.storeSprintContract(phaseSprintContract);

        const phaseEvalContract = createEvaluationContract({
          contractId: phaseContractId,
          blockingChecks: ["fitness", "scope", "tests"],
          thresholds: { fitness: 0.4 },
          failureDisposition: "block",
        });
        contractLedger.storeEvaluationContract(phaseEvalContract);
      }

      const phaseResult = _verifyPhaseCompletion(
        repoRoot, currentPhaseId, prevPhaseItems, completedIds, detectRegressions,
        hasPromotionData
          ? { evaluationContractId: phaseContractId, promotionGate, scores: { fitness: lastFitnessResult!.score } }
          : undefined,
      );
      if (!phaseResult.passed) {
        console.log(`  \x1b[31m✗ Phase gate FAILED\x1b[0m`);
        for (const f of phaseResult.failures) console.log(`    ✗ ${f}`);
        console.log(`\n  Cannot proceed to ${wave.phaseId}. Fix issues and --resume.\n`);
        checkpointStore.save({ trackName, completedIds: [...completedIds], failedIds: [], lastCompletedWave: gi - 1, updatedAt: "", totalItems: totalWBs, lastFitness: lastFitnessResult?.score, totalWaves: waves.length });
        await mux.cleanup();
        if (bridge?.close) bridge.close();
        return;
      }
      console.log(`  \x1b[32m✓ Phase gate passed\x1b[0m — ${currentPhaseId} verified\n`);
    }
    currentPhaseId = wave.phaseId ?? currentPhaseId;

    // ── Handoff gate: block if previous wave's handoff is incomplete (A-3) ──
    // Skip for resumed waves (ledger is in-memory, no state from prior runs)
    const prevWaveWasInThisRun = gi > 0 && !(resumeMode && gi - 1 <= skipUntilWave);
    if (prevWaveWasInThisRun) {
      const prevContractId = `${trackName}/wave-${gi - 1}`;
      const handoffCheck = handoffGate.canResume(prevContractId);
      if (!handoffCheck.allowed) {
        console.log(`  \x1b[31m✗ Handoff gate blocked wave ${gi + 1}:\x1b[0m ${handoffCheck.reason}`);
        console.log(`  Previous wave must complete successfully before proceeding.\n`);
        checkpointStore.save({ trackName, completedIds: [...completedIds], failedIds: [], lastCompletedWave: gi - 1, updatedAt: "", totalItems: totalWBs, lastFitness: lastFitnessResult?.score, totalWaves: waves.length });
        break;
      }
    }

    // ── Iteration policy: check consecutive wave failures (A-3) ──
    if (isExhausted(iterationPolicy, consecutiveFailedWaves)) {
      console.log(`  \x1b[31m✗ Iteration budget exhausted:\x1b[0m ${consecutiveFailedWaves} consecutive failed waves >= ${iterationPolicy.maxAttempts} max`);
      break;
    }
    if (shouldEscalate(iterationPolicy, consecutiveFailedWaves)) {
      console.log(`  \x1b[33m⚠ Escalation threshold reached:\x1b[0m ${consecutiveFailedWaves} consecutive failures — consider model tier upgrade\n`);
    }

    const phaseLabel = wave.phaseId ? ` \x1b[2m(${wave.phaseId})\x1b[0m` : "";
    console.log(`  \x1b[1mWave ${wave.index + 1}/${waves.length}\x1b[0m (${wave.items.length} items)${phaseLabel}\n`);
    const waveSnapshotRef = captureSnapshot(repoRoot);
    const previousManifests = readPreviousManifests(bridge, trackName, gi);

    // ── Sprint contract with bilateral negotiation (PLT-6F + A-5) ──
    const waveContractId = `${trackName}/wave-${gi}`;
    const draftContract = createSprintContract({
      trackName,
      waveId: `wave-${gi}`,
      scope: wave.items.map(i => i.id),
      doneCriteria: wave.items.filter(i => i.done).map(i => i.done!),
      evidenceRequired: wave.items.filter(i => i.verify).map(i => i.verify!),
      approvalState: "draft",
    });
    draftContract.contractId = waveContractId;

    // Evaluator-side negotiation: fitness gate + scope gates register as evaluator participant
    const plannerRecord = createNegotiationRecord({
      sprintContractId: waveContractId,
      proposedBy: "planner",
      status: "approved",
      participants: ["planner"],
    });
    const evaluatorRecord = createNegotiationRecord({
      sprintContractId: waveContractId,
      proposedBy: "evaluator",
      status: "approved",
      requestedChanges: draftContract.evidenceRequired.length > 0
        ? [`${draftContract.evidenceRequired.length} verify command(s) required`]
        : ["No explicit verify commands — mechanical gates will enforce"],
      participants: ["evaluator", "fitness-gate", "scope-gate"],
    });

    // Bilateral approval: evaluator must have participated
    const approvedContract = approveWithNegotiation(draftContract, [plannerRecord, evaluatorRecord]);
    contractLedger.storeSprintContract(approvedContract);

    // Evaluation contract for phase promotion (A-3: canPromote requires this)
    const evalContract = createEvaluationContract({
      contractId: waveContractId,
      blockingChecks: ["fitness", "scope", "blueprint"],
      thresholds: { fitness: 0.4 },
      failureDisposition: "retry",
    });
    contractLedger.storeEvaluationContract(evalContract);

    const waveResult = await runWave({
      repoRoot, wave, waveIndex: gi, totalWaves: waves.length, totalItems: totalWBs,
      trackName, provider, auditor, maxConcurrency, maxRetries,
      mux, bridge, completedIds, blueprintRules, rtmPath,
      manifests: previousManifests, snapshotRef: waveSnapshotRef,
      auditFn: runWaveAuditLLM,
      contractId: waveContractId,
      promotionGate,
      onLog: (msg: string) => console.log(msg),
      onProgress: (completed, total, active, waiting, elapsed) => {
        const pct = totalWBs > 0 ? Math.round((completedWBs / totalWBs) * 100) : 0;
        const sec = Math.round(elapsed / 1000);
        const waitingSuffix = waiting > 0 ? ` ${waiting} blocked` : "";
        process.stdout.write(`\r    [${completedWBs}/${totalWBs}] ${pct}% ${sec}s ${active} active${waitingSuffix}    `);
      },
    });
    console.log();

    // ── Handoff artifact for completed wave (PLT-6F) ──
    if (waveResult.passed && waveResult.completedItemIds.length > 0) {
      const handoff = createHandoffArtifact({
        contractId: waveContractId,
        summary: `Wave ${gi + 1} completed: ${waveResult.completedItemIds.join(", ")}`,
        openItems: waveResult.timedOutIds,
        nextAction: gi < waves.length - 1 ? `Proceed to wave ${gi + 2}` : "Track complete — run E2E verification",
      });
      contractLedger.storeHandoffArtifact(handoff);
    }

    completedWBs += waveResult.completedItemIds.length;
    failedWBs += waveResult.timedOutIds.length;
    if (waveResult.fitnessResult) lastFitnessResult = waveResult.fitnessResult;
    if (!waveResult.passed && waveResult.auditGates?.completedItems.length) {
      failedWBs += waveResult.auditGates.completedItems.length;
    }
    // Track consecutive wave failures for iteration policy
    consecutiveFailedWaves = waveResult.passed ? 0 : consecutiveFailedWaves + 1;
    printWaveAuditDetails(wave, waveResult);
    for (const itemId of waveResult.completedItemIds) {
      const item = wave.items.find(i => i.id === itemId);
      if (hasHierarchy && item?.parentId) {
        const parentStatus = parentChildStatus.get(item.parentId);
        if (parentStatus) {
          parentStatus.completed.add(item.id);
          if (parentStatus.completed.size === parentStatus.total) {
            console.log(`    \x1b[36m◆\x1b[0m ${item.parentId} complete (${parentStatus.total}/${parentStatus.total})`);
          }
        }
      }
    }
    for (const id of waveResult.timedOutIds) console.log(`    \x1b[31m✗\x1b[0m ${id} timed out`);
    recordWaveManifest(repoRoot, bridge, trackName, gi, waveResult.auditGates?.completedItems ?? [], waveSnapshotRef);
    checkpointStore.save({
      trackName, completedIds: [...completedIds],
      failedIds: waveResult.timedOutIds, lastCompletedWave: gi,
      updatedAt: "", totalItems: totalWBs,
      lastFitness: lastFitnessResult?.score, totalWaves: waves.length,
    });
  }
  if (bridge?.claim?.releaseFiles) bridge.claim.releaseFiles("contract-guardian");
  console.log(`\n${"═".repeat(60)}\n`);
  console.log(`  \x1b[1mResult:\x1b[0m ${completedWBs}/${totalWBs} WBs approved`);
  if (failedWBs > 0) {
    console.log(`  \x1b[31m✗ ${failedWBs} item(s) FAILED — no evidence or rejected after max retries\x1b[0m`);
  }
  if (unverifiedWBs > 0) {
    console.log(`  \x1b[33m⧖ ${unverifiedWBs} item(s) awaiting audit verdict — run 'quorum audit'\x1b[0m`);
  }
  if (hasHierarchy) {
    for (const [id, s] of parentChildStatus) {
      if (s.completed.size === s.total) console.log(`  \x1b[36m✓ ${id} ready\x1b[0m`);
      else console.log(`  \x1b[33mParent ${id}:\x1b[0m ${s.completed.size}/${s.total} children done`);
    }
  }

  if (completedWBs === totalWBs && failedWBs === 0 && unverifiedWBs === 0) {
    await runE2EVerification(repoRoot, waves, blueprintRules, bridge, trackName, totalWBs);
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

// ── Helpers (presentation + contract protection) ──

function claimContractFiles(repoRoot: string, bridge: Bridge | null): void {
  if (!bridge?.claim?.claimFiles) return;
  try {
    const isTs = (n: string) => n.endsWith(".ts") || n.endsWith(".tsx");
    const contractDirs = ["types", "contracts", "interfaces"];
    const contractFiles: string[] = [];
    const scan = (dir: string, depth = 0): void => {
      if (depth > 5) return;
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
          const full = resolve(dir, e.name);
          if (e.isDirectory()) {
            if (contractDirs.includes(e.name)) contractFiles.push(...walkSourceFiles(full, isTs));
            else scan(full, depth + 1);
          }
        }
      } catch (err) { console.warn(`[runner] scan directory failed for ${dir}: ${(err as Error).message}`); }
    };
    scan(repoRoot);
    if (contractFiles.length > 0) {
      const conflicts = bridge.claim.claimFiles("contract-guardian", contractFiles, undefined, 3600_000);
      if (conflicts.length > 0) console.log(`  \x1b[33m⚠ ${conflicts.length} contract file(s) held by other agents\x1b[0m`);
      else console.log(`  \x1b[36m🔒 ${contractFiles.length} contract file(s) protected\x1b[0m`);
    }
  } catch (err) { console.warn(`[runner] claimContractFiles failed: ${(err as Error).message}`); }
}

/** Pick a default auditor that differs from the provider for cross-model review. */
function _defaultAuditor(provider: string): string {
  // Prefer gemini (fast, stable parsing) → codex → claude.
  // Same-provider audit is blocked — cross-model review is mandatory.
  // Only CLI-spawnable providers (ollama is HTTP-only, would fail in runWaveAuditLLM).
  const candidates = ["gemini", "codex", "claude"];
  for (const c of candidates) {
    if (c !== provider) return c;
  }
  // Fallback: still return different model. If truly no option, warn at call site.
  return candidates[0]!;
}

function printWaveAuditDetails(wave: Wave, wr: WaveResult): void {
  const ag = wr.auditGates;
  if (ag) {
    const printSection = (items: string[], label: string, color: string, icon: string, max = Infinity) => {
      if (items.length === 0) return;
      console.log(`\n  \x1b[${color}m◈ ${label}\x1b[0m`);
      for (const x of items.slice(0, max)) console.log(`    ${icon} ${x}`);
      if (items.length > max) console.log(`    ... and ${items.length - max} more`);
    };
    printSection(ag.regressions, `Wave ${wave.index + 1} REGRESSION detected`, "31", "✗");
    printSection(ag.perfFindings, "Perf anti-patterns detected", "33", "⚠", 5);
    if (ag.dependencyIssues.length > 0) {
      console.log(`\n  \x1b[31m◈ Dependency audit\x1b[0m`);
      for (const d of ag.dependencyIssues) console.log(`    ${d.includes("copyleft") ? "✗" : "⚠"} ${d}`);
    }
    printSection(ag.scopeViolations, "File scope violations", "33", "⚠");
    const fg = ag.fitnessResult;
    const sc = fg.score >= 0.7 ? "32" : fg.score >= 0.4 ? "33" : "31";
    console.log(`  \x1b[${sc}m◈ Fitness: ${fg.score.toFixed(2)}\x1b[0m — ${fg.decision} (${fg.reason})`);
    printSection(ag.missingTests, "Test file creation check", "33", "⚠");
    printSection(ag.constraintViolations, "WB constraint violations", "33", "⚠");
  }
  console.log(`  \x1b[${wr.passed ? "32m✓" : "31m✗"}\x1b[0m Wave ${wave.index + 1} ${wr.passed ? "passed" : "failed"}`);
  if (wr.testResult?.ran) {
    console.log(wr.testResult.passed ? `  \x1b[32m✓ Project tests passed\x1b[0m` : `  \x1b[33m⚠ Project tests failed\x1b[0m — ${wr.testResult.summary}`);
  }
}

// ── Backward-compatible re-exports ───────────

export { spawnAgent, captureAgentOutput, isAgentComplete, type SpawnAgentOptions, type AgentHandle, type AgentSessionState } from "../../../orchestrate/execution/agent-session.js";
export { buildWaveRoster, canSpawnItem, type RosterSlot } from "../../../orchestrate/execution/roster-builder.js";
export { WaveSessionState, type ActiveSession, type FailedItem } from "../../../orchestrate/execution/session-state.js";
export { runPreflightCheck, walkSourceFiles, type PreflightResult };
export { collectFitnessSignals, runFitnessGate, type FitnessGateResult } from "../../../orchestrate/governance/fitness-gates.js";
import { scanLines, scanForStubs, scanForPerfAntiPatterns, getChangedFiles, detectFileScopeViolations, scanBlueprintViolations, detectOrphanFiles, auditNewDependencies, checkTestFileCreation, checkWBConstraints, detectFixLoopStagnation, runProjectTests, detectRegressions } from "../../../orchestrate/governance/scope-gates.js";
export { scanLines, scanForStubs, scanForPerfAntiPatterns, getChangedFiles, detectFileScopeViolations, scanBlueprintViolations, detectOrphanFiles, auditNewDependencies, checkTestFileCreation, checkWBConstraints, detectFixLoopStagnation, runProjectTests, detectRegressions };
export { buildDepContextFromManifests, type WaveManifest } from "../../../orchestrate/execution/dependency-context.js";
export { runWaveAuditGates, type WaveAuditResult, type WaveAuditOptions } from "../../../orchestrate/execution/audit-loop.js";
export { updateRTM } from "../../../orchestrate/governance/rtm-updater.js";
export { generateSkeletalRTM };
export { waveCommit } from "../../../orchestrate/governance/lifecycle-hooks.js";

export function verifyPhaseCompletion(
  repoRoot: string, phaseId: string, phaseItems: WorkItem[], completedIds: Set<string>,
): { passed: boolean; failures: string[] } {
  return _verifyPhaseCompletion(repoRoot, phaseId, phaseItems, completedIds, detectRegressions);
}
