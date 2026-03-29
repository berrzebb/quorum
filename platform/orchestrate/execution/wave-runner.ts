/**
 * Wave runner — thin coordinator that orchestrates one wave execution cycle.
 *
 * Assembly module only. Calls other modules in sequence:
 *   1. roster-builder  → build roster
 *   2. agent-session   → spawn agents, poll for completion
 *   3. audit-loop      → run mechanical governance gates
 *   4. fixer-loop      → fix-retry cycle on failure
 *   5. lifecycle-hooks  → commit wave
 *
 * Minimal own logic: orchestration glue only.
 */

import type { WorkItem, Wave, Bridge } from "../../cli/commands/orchestrate/shared.js";
import type { NamingRule } from "../../bus/blueprint-parser.js";
import type { FitnessGateResult } from "../governance/fitness-gates.js";
import type { WaveAuditResult } from "./audit-loop.js";
import type { RosterEntry } from "./implementer-prompt.js";
import type { WaveManifest } from "./dependency-context.js";
import type { ContractLedger } from "../../core/harness/contract-ledger.js";
import type { PromotionGate, PromotionGateResult } from "../../bus/promotion-gate.js";
import { buildWaveRoster, canSpawnItem } from "./roster-builder.js";
import {
  spawnAgent, removeAgentState, captureAgentOutput, isAgentComplete,
  type AgentHandle,
} from "./agent-session.js";
import { runWaveAuditGates } from "./audit-loop.js";
import { runFixer, runFixCycle, type FixerResult } from "./fixer-loop.js";
import {
  STUB_PATTERNS,
  scanLines,
  scanBlueprintViolations,
  detectFixLoopStagnation,
  runProjectTests,
} from "../governance/scope-gates.js";
import {
  runConfluenceCheck,
  proposeConfluenceAmendments,
} from "../governance/confluence-gates.js";
import { waveCommit, amendWaveCommit } from "../governance/lifecycle-hooks.js";
import { updateRTM } from "../governance/rtm-updater.js";

// ── Types ────────────────────────────────────

/** Options for running a single wave. */
export interface WaveRunnerOptions {
  repoRoot: string;
  wave: Wave;
  waveIndex: number;
  totalWaves: number;
  trackName: string;
  provider: string;
  auditor: string;
  maxConcurrency: number;
  maxRetries: number;
  mux: any;
  bridge: Bridge | null;
  completedIds: Set<string>;
  blueprintRules: NamingRule[];
  rtmPath: string;
  /** Previous wave manifests for dependency context. */
  manifests: WaveManifest[];
  /** Snapshot ref captured before the wave started. */
  snapshotRef: string;
  /** LLM audit function (injected — kept in runner.ts to avoid moving CLI spawn logic). */
  auditFn: (repoRoot: string, files: string[], items: any[], provider: string) => Promise<{ passed: boolean; findings: string[] }>;
  /** Callback for console output / progress reporting. */
  onLog?: (msg: string) => void;
  /** Callback for progress ticker updates. */
  onProgress?: (completed: number, total: number, active: number, waiting: number, elapsed: number) => void;
  // [CONTRACT CONTROL PLANE] Optional sprint contract binding.
  // When contractId is provided and promotionGate is available, verify sprint is
  // approved before starting wave execution. See PLT-6D/6E for contract model details.
  /** Sprint contract ID — enables contract-gated wave execution when set. */
  contractId?: string;
  /** Promotion gate instance — required when contractId is set. */
  promotionGate?: PromotionGate;
}

/** Result of a single wave execution. */
export interface WaveResult {
  /** Whether the wave passed all gates and audit. */
  passed: boolean;
  /** IDs of items completed by agents. */
  completedItemIds: string[];
  /** IDs of items that timed out. */
  timedOutIds: string[];
  /** Fitness gate result (if available). */
  fitnessResult?: FitnessGateResult;
  /** Audit gates result. */
  auditGates?: WaveAuditResult;
  /** Whether the wave was blueprint-blocked (auto-reject). */
  blueprintBlocked: boolean;
  /** Project test result (if run). */
  testResult?: { ran: boolean; passed: boolean; summary: string };
}

// ── Constants ───────────────────────────────

const POLL_INTERVAL = 5000;
const TIMEOUT = 600_000;
const MAX_OUTPUT_BYTES = 2_000_000;
const STALL_THRESHOLD = 120_000;

// ── Main Entry Point ────────────────────────

/**
 * Run a single wave: spawn agents, poll completion, audit, fix, commit.
 *
 * Returns a structured result. The caller (runner.ts) handles:
 * - Resume state persistence
 * - Console output formatting
 * - Wave-to-wave orchestration
 */
export async function runWave(opts: WaveRunnerOptions): Promise<WaveResult> {
  const {
    repoRoot, wave, trackName, provider, auditor, maxConcurrency, maxRetries,
    mux, bridge, completedIds, blueprintRules, rtmPath, manifests, snapshotRef,
    auditFn, onLog, onProgress,
  } = opts;

  const log = onLog ?? (() => {});

  // [CONTRACT CONTROL PLANE] Optional sprint contract check
  // When contractId is provided and promotionGate is available, verify sprint is approved
  // before starting wave execution. See PLT-6D/6E for contract model details.
  if (opts.contractId && opts.promotionGate) {
    const gateResult: PromotionGateResult = opts.promotionGate.canStartWave(opts.contractId);
    if (!gateResult.allowed) {
      log(`  \x1b[31m✗ Contract gate blocked wave: ${gateResult.reason}\x1b[0m`);
      return {
        passed: false,
        completedItemIds: [],
        timedOutIds: [],
        blueprintBlocked: false,
      };
    }
  }

  // ── 1. Build roster ─────────────────────────
  const rosterSlots = buildWaveRoster(wave, maxConcurrency);
  const roster: RosterEntry[] = rosterSlots.map(s => ({
    agentId: s.agentId, wbId: s.wbId,
    targetFiles: s.targetFiles, dependsOn: s.dependsOn,
  }));

  if (bridge?.setState) {
    bridge.setState(`agent:roster:${trackName}`, {
      trackName, groupIndex: opts.waveIndex, agents: roster, startedAt: Date.now(),
    });
  }

  // ── 2. Spawn agents + poll ──────────────────
  const tmpDir = _ensureTmpDir(repoRoot);
  const active: Array<{ item: WorkItem; sessionId: string; retries: number; outputFile?: string }> = [];
  const groupIds = new Set(wave.items.map(i => i.id));
  const spawned = new Set<string>();
  const localCompleted = new Set<string>();
  const timedOutIds: string[] = [];
  const lastOutputSize = new Map<string, { size: number; at: number }>();

  const canSpawn = (item: WorkItem): boolean => canSpawnItem(item, groupIds, completedIds);

  const spawnItem = async (item: WorkItem): Promise<void> => {
    if (bridge?.claimFiles && item.targetFiles.length > 0) {
      bridge.claimFiles(`impl-${item.id}`, item.targetFiles, undefined, 1800_000);
    }

    const handle = await spawnAgent({
      repoRoot, item, trackName, provider, mux, tmpDir, roster, manifests,
    });

    if (handle) {
      active.push({ item, sessionId: handle.sessionId, retries: 0, outputFile: handle.outputFile });
      spawned.add(item.id);
      log(`    \x1b[32m+\x1b[0m ${item.id} spawned`);
      if (handle.tier.domains.length > 0) {
        log(`      \x1b[2mdomains: ${handle.tier.domains.join(", ")} → ${handle.tier.model ?? "default"}\x1b[0m`);
      }
      if (bridge?.emitEvent) {
        bridge.emitEvent("agent.spawn", "generic", {
          agentId: `impl-${item.id}`, role: "implementer",
          trackId: trackName, wbId: item.id, sessionId: handle.sessionId,
        });
      }
    } else {
      log(`    \x1b[31m!\x1b[0m ${item.id} spawn failed`);
      spawned.add(item.id);
    }
  };

  // Initial spawn
  for (const item of wave.items) {
    if (active.length >= maxConcurrency) break;
    if (canSpawn(item)) await spawnItem(item);
  }

  // Poll loop
  const start = Date.now();

  while ((active.length > 0 || spawned.size < wave.items.length) && Date.now() - start < TIMEOUT) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    for (let si = active.length - 1; si >= 0; si--) {
      const s = active[si]!;
      const pollOutput = captureAgentOutput(s.outputFile, mux, s.sessionId);
      if (!pollOutput) continue;

      const outputBytes = Buffer.byteLength(pollOutput, "utf8");
      if (outputBytes > MAX_OUTPUT_BYTES) {
        log(`\n    \x1b[31m!\x1b[0m ${s.item.id} output exceeded ${Math.round(MAX_OUTPUT_BYTES / 1_000_000)}MB — killing`);
        try { await mux.kill(s.sessionId); } catch {}
        active.splice(si, 1);
        removeAgentState(repoRoot, s.sessionId);
        continue;
      }

      const prev = lastOutputSize.get(s.sessionId);
      if (prev && prev.size === outputBytes && Date.now() - prev.at > STALL_THRESHOLD) {
        log(`\n    \x1b[31m!\x1b[0m ${s.item.id} stalled (no output for ${Math.round(STALL_THRESHOLD / 1000)}s) — killing`);
        try { await mux.kill(s.sessionId); } catch {}
        active.splice(si, 1);
        removeAgentState(repoRoot, s.sessionId);
        continue;
      }
      lastOutputSize.set(s.sessionId, {
        size: outputBytes,
        at: prev?.size !== outputBytes ? Date.now() : (prev?.at ?? Date.now()),
      });

      if (!isAgentComplete(pollOutput)) continue;

      log(`    \x1b[32m✓\x1b[0m ${s.item.id} done`);
      completedIds.add(s.item.id);
      localCompleted.add(s.item.id);
      active.splice(si, 1);
      removeAgentState(repoRoot, s.sessionId);
      try { await mux.kill(s.sessionId); } catch {}

      if (bridge?.emitEvent) {
        bridge.emitEvent("track.progress", "generic", {
          trackId: trackName, completed: completedIds.size, pending: active.length,
          total: wave.items.length, blocked: 0, failed: 0,
        });
      }
    }

    // Spawn newly unblocked items
    for (const item of wave.items) {
      if (active.length >= maxConcurrency) break;
      if (!spawned.has(item.id) && canSpawn(item)) await spawnItem(item);
    }

    if (onProgress) {
      const waitingCount = wave.items.filter(i => !spawned.has(i.id)).length;
      onProgress(completedIds.size, wave.items.length, active.length, waitingCount, Date.now() - start);
    }
  }

  // Timeout cleanup
  for (const s of active) {
    timedOutIds.push(s.item.id);
    removeAgentState(repoRoot, s.sessionId);
    try { await mux.kill(s.sessionId); } catch {}
  }
  for (const item of wave.items) {
    if (bridge?.releaseFiles) bridge.releaseFiles(`impl-${item.id}`);
  }

  // ── 3. Run audit gates ──────────────────────
  const auditGates = runWaveAuditGates({
    repoRoot, wave, completedIds, snapshotRef, blueprintRules, bridge,
  });

  const completedItems = auditGates.completedItems;
  const waveFiles = auditGates.waveFiles;
  let fitnessDecision = auditGates.fitnessDecision;
  let blueprintBlocked = auditGates.blueprintBlocked;

  // ── 4. Fix gate findings ────────────────────
  if (auditGates.regressions.length > 0) {
    log(`\n  \x1b[31m◈ REGRESSION detected\x1b[0m`);
    await runFixer({
      repoRoot,
      findings: auditGates.regressions,
      files: auditGates.regressions.map(r => r.split(":")[0]!.trim()),
      provider,
      fitnessContext: auditGates.fitnessResult,
    });
  }

  if (completedItems.length > 0) {
    // Stub fix
    if (auditGates.stubs.length > 0) {
      log(`\n  \x1b[31m◈ Stub/placeholder detected — fixing\x1b[0m`);
      await runFixer({ repoRoot, findings: auditGates.stubs, files: waveFiles, provider, fitnessContext: auditGates.fitnessResult });
      const remaining = scanLines(repoRoot, waveFiles, STUB_PATTERNS);
      if (remaining.length > 0) log(`  \x1b[33m⚠ ${remaining.length} stub(s) remain after fix\x1b[0m`);
    }

    // Blueprint fix
    if (auditGates.blueprintViolations.length > 0) {
      log(`\n  \x1b[31m◈ Blueprint naming violations — fixing\x1b[0m`);
      await runFixer({ repoRoot, findings: auditGates.blueprintViolations, files: waveFiles, provider, fitnessContext: auditGates.fitnessResult });
      const remaining = scanBlueprintViolations(repoRoot, waveFiles, blueprintRules);
      if (remaining.length > 0) {
        blueprintBlocked = true;
        fitnessDecision = "auto-reject";
      }
    }

    // Fitness auto-reject → fixer
    if (fitnessDecision === "auto-reject") {
      const fg = auditGates.fitnessResult;
      const fitnessFindings = [
        `Fitness score ${fg.score.toFixed(2)} below threshold: ${fg.reason}`,
        ...(fg.components ?? []).filter((c: any) => c.score < 0.5).map((c: any) => `Component "${c.name}" = ${c.score.toFixed(2)} (below 0.5)`),
      ];
      await runFixer({ repoRoot, findings: fitnessFindings, files: waveFiles, provider, fitnessContext: fg });
    }

    // ── 5. RTM + WIP Commit ──────────────────
    updateRTM(rtmPath, completedItems, "implemented");
    const committed = waveCommit(repoRoot, [...waveFiles, rtmPath], wave.index + 1, trackName);
    if (committed) log(`  \x1b[36m◈ WIP commit created\x1b[0m`);

    // ── 6. LLM Audit + Fix Cycle ─────────────
    let wavePassed = fitnessDecision !== "auto-reject";
    let testResult: { ran: boolean; passed: boolean; summary: string } | undefined;

    if (completedItems.length > 0 && fitnessDecision !== "auto-reject") {
      log(`  \x1b[36m◈ LLM audit\x1b[0m (auditor: ${auditor}, max retries: ${maxRetries})`);
      const auditStart = Date.now();
      const fixResult = await runFixCycle({
        repoRoot,
        files: waveFiles,
        provider: auditor,          // auditor does the review
        fixerProvider: provider,    // implementer does the fixing
        maxRounds: maxRetries,
        fitnessContext: auditGates.fitnessResult,
        auditFn,
        completedItems,
        detectStagnation: detectFixLoopStagnation,
      });
      const auditSec = Math.round((Date.now() - auditStart) / 1000);

      wavePassed = fixResult.passed;

      if (fixResult.passed) {
        log(`  \x1b[32m✓ LLM audit passed\x1b[0m (${fixResult.attempts} round(s), ${auditSec}s)`);
        // Confluence verification
        testResult = runProjectTests(repoRoot);
        const confluenceResult = runConfluenceCheck(true, testResult);
        if (!confluenceResult.passed && bridge?.store) {
          proposeConfluenceAmendments(bridge.store, confluenceResult.suggestedAmendments);
        }

        // RTM: passed
        updateRTM(rtmPath, completedItems, "passed");
        amendWaveCommit(repoRoot, rtmPath);
      } else {
        log(`  \x1b[31m✗ LLM audit FAILED\x1b[0m (${fixResult.attempts} round(s), ${auditSec}s)`);
        if (fixResult.stagnation) log(`    stagnation: ${fixResult.stagnation}`);
        for (const round of fixResult.findingsHistory) {
          for (const f of round.slice(0, 3)) log(`    - ${f}`);
          if (round.length > 3) log(`    ... and ${round.length - 3} more`);
        }
        // Rollback or mark failed
        const { execSync } = await import("node:child_process");
        try {
          execSync("git revert HEAD --no-edit", { cwd: repoRoot, timeout: 30_000, stdio: "pipe", windowsHide: true });
        } catch {
          updateRTM(rtmPath, completedItems, "failed");
          amendWaveCommit(repoRoot, rtmPath);
        }
      }
    }

    // Handle fitness auto-reject rollback
    if (fitnessDecision === "auto-reject") {
      const { execSync } = await import("node:child_process");
      try {
        execSync("git revert HEAD --no-edit", { cwd: repoRoot, timeout: 30_000, stdio: "pipe", windowsHide: true });
      } catch {
        updateRTM(rtmPath, completedItems, "failed");
        amendWaveCommit(repoRoot, rtmPath);
      }
      wavePassed = false;
    }

    // ── 7. Project test gate ─────────────────
    if (!testResult) testResult = runProjectTests(repoRoot);

    return {
      passed: wavePassed,
      completedItemIds: [...localCompleted],
      timedOutIds,
      fitnessResult: auditGates.fitnessResult,
      auditGates,
      blueprintBlocked,
      testResult,
    };
  }

  // No completed items
  return {
    passed: true,
    completedItemIds: [],
    timedOutIds,
    fitnessResult: auditGates.fitnessResult,
    auditGates,
    blueprintBlocked: false,
  };
}

// ── Helpers ─────────────────────────────────

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function _ensureTmpDir(repoRoot: string): string {
  const tmpDir = resolve(repoRoot, ".claude", "agents", "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}
