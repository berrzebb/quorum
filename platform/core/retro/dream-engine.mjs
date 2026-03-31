/**
 * Dream Engine — orchestrates the full consolidation pipeline.
 *
 * Single entry point for all consolidation triggers:
 * - Wave-end (auto, after audit)
 * - Scheduled (background, 3-gate trigger)
 * - Manual (`quorum retro --consolidate`)
 *
 * Core invariant: Dream failure NEVER blocks retro gate release or next-wave handoff.
 * All callers get either a digest or a graceful skip/error.
 *
 * @module core/retro/dream-engine
 * @since RDI-5
 */

import { gatherSignals } from "./signal-gatherer.mjs";
import { consolidate } from "./consolidate.mjs";
import { planPrune, applyPrune } from "./prune.mjs";
import { generateDigest, serializeDigest, summarizeDigest } from "./digest.mjs";
import { tryAcquire, release, rollback, reclaimStale, persistConsolidationTimestamp, checkLock } from "./consolidation-lock.mjs";
import { evaluateTrigger, evaluateWaveEndTrigger, transitionConsolidation } from "./trigger-policy.mjs";

// ── Types (JSDoc) ────────────────────────────

/**
 * @typedef {Object} DreamRunResult
 * @property {"completed"|"skipped"|"failed"} status
 * @property {import("./digest.mjs").RetroDigest|null} digest
 * @property {string} reason
 * @property {number} durationMs
 */

/**
 * @typedef {Object} DreamRunInput
 * @property {string} trackName
 * @property {number} waveIndex
 * @property {"wave-end"|"scheduled"|"manual"} trigger
 * @property {string} lockDir - directory for consolidation lock
 * @property {object[]} [auditRecords]
 * @property {object[]} [compactSummaries]
 * @property {object[]} [memoryEntries]
 * @property {string[]} [transcriptLines]
 * @property {import("./trigger-policy.mjs").RetroState} [retroState]
 * @property {object} [triggerThresholds]
 * @property {number} [sessionCount]
 * @property {(event: string, payload: object) => void} [emitEvent]
 */

// ── Engine ───────────────────────────────────

/**
 * Run the Dream consolidation pipeline.
 *
 * Stages:
 * 1. Evaluate trigger (skip if not eligible, unless manual)
 * 2. Acquire lock (skip if unavailable)
 * 3. Gather signals
 * 4. Consolidate
 * 5. Prune
 * 6. Generate digest
 * 7. Release lock with updated timestamp
 *
 * On failure at any stage: rollback lock, return error status.
 * Caller is responsible for handling the result — engine never throws.
 *
 * @param {DreamRunInput} input
 * @returns {Promise<DreamRunResult>}
 */
export async function runDream(input) {
  const start = Date.now();
  const emit = input.emitEvent ?? (() => {});

  // ── Stage 1: Trigger evaluation ────────────
  if (input.trigger !== "manual") {
    const lockDir = input.lockDir;

    if (input.trigger === "wave-end") {
      const snap = evaluateWaveEndTrigger(
        !isLockHeld(lockDir),
        true, // wave ending implies there were findings
      );
      if (!snap.eligible) {
        return { status: "skipped", digest: null, reason: snap.reason, durationMs: Date.now() - start };
      }
    } else if (input.trigger === "scheduled" && input.retroState) {
      const snap = evaluateTrigger(
        input.retroState,
        !isLockHeld(lockDir),
        input.triggerThresholds,
      );
      emit("dream.trigger.evaluate", { trigger: input.trigger, snapshot: snap });
      if (!snap.eligible) {
        return { status: "skipped", digest: null, reason: snap.reason, durationMs: Date.now() - start };
      }
    }
  }

  // ── Stage 2: Acquire lock ──────────────────
  let lockResult = tryAcquire(input.lockDir);

  // If blocked by stale lock, reclaim and retry once
  if (!lockResult.acquired && lockResult.reason.includes("stale")) {
    reclaimStale(input.lockDir);
    lockResult = tryAcquire(input.lockDir);
  }

  if (!lockResult.acquired) {
    return {
      status: "skipped",
      digest: null,
      reason: `lock: ${lockResult.reason}`,
      durationMs: Date.now() - start,
    };
  }

  const handle = lockResult.handle;
  emit("dream.consolidation.start", { trigger: input.trigger, trackName: input.trackName });

  try {
    // ── Stage 3: Gather ────────────────────────
    const gatherResult = gatherSignals({
      trackName: input.trackName,
      waveIndex: input.waveIndex,
      auditRecords: input.auditRecords ?? [],
      compactSummaries: input.compactSummaries ?? [],
      memoryEntries: input.memoryEntries ?? [],
      transcriptLines: input.transcriptLines ?? [],
      sessionCount: input.sessionCount,
    });

    // ── Stage 4: Consolidate ───────────────────
    const consolidation = consolidate(gatherResult.signals);

    // ── Stage 5: Prune ─────────────────────────
    const pruneJournal = planPrune(gatherResult.signals, input.memoryEntries ?? []);

    // ── Stage 6: Generate digest ───────────────
    const digest = generateDigest({
      trackName: input.trackName,
      waveIndex: input.waveIndex,
      consolidation,
      pruneJournal,
      source: input.trigger,
      stats: gatherResult.stats,
    });

    // ── Stage 7: Release lock ──────────────────
    const releaseResult = release(handle);
    persistConsolidationTimestamp(input.lockDir, releaseResult.lastConsolidatedAt);

    emit("dream.consolidation.complete", {
      digestId: digest.id,
      summary: summarizeDigest(digest),
      durationMs: Date.now() - start,
    });
    emit("dream.digest.generated", { digest: serializeDigest(digest) });

    if (pruneJournal.merged + pruneJournal.removed + pruneJournal.demoted > 0) {
      emit("dream.prune.applied", {
        merged: pruneJournal.merged,
        removed: pruneJournal.removed,
        demoted: pruneJournal.demoted,
      });
    }

    return {
      status: "completed",
      digest,
      reason: summarizeDigest(digest),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    // Rollback lock on failure
    rollback(handle);

    const reason = `consolidation failed: ${err?.message ?? err}`;
    emit("dream.consolidation.failed", { error: reason });

    return {
      status: "failed",
      digest: null,
      reason,
      durationMs: Date.now() - start,
    };
  }
}

// ── Helpers ──────────────────────────────────

function isLockHeld(lockDir) {
  try {
    return checkLock(lockDir).locked;
  } catch {
    return false;
  }
}
