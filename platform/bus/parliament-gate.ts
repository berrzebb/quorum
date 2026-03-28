/**
 * Parliament Enforcement Gates — structural enforcement, not guidelines.
 *
 * These gates BLOCK work when parliament protocol conditions are violated.
 * Each gate returns { allowed: boolean, reason?: string }.
 *
 * Gates:
 * 1. Amendment gate: blocks when pending amendments exist
 * 2. Verdict gate: blocks when latest audit verdict != approved
 * 3. Confluence gate: blocks when latest confluence check failed
 * 4. Design gate: blocks WB generation when design artifacts missing
 * 5. Regression gate: detects normal-form stage regression
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { EventStore } from "./store.js";
import { AUDIT_VERDICT } from "./events.js";
import { getPendingAmendmentCount } from "./amendment.js";
import { STAGE_ORDER, type ConformanceStage } from "./normal-form.js";

// ── Gate result ─────────────────────────────

export interface GateResult {
  allowed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

// ── Amendment gate ──────────────────────────

/**
 * Block implementation when unresolved amendments exist.
 * Proposed or deferred amendments must be voted on before proceeding.
 */
export function checkAmendmentGate(store: EventStore): GateResult {
  try {
    const pendingCount = getPendingAmendmentCount(store);

    if (pendingCount > 0) {
      return {
        allowed: false,
        reason: `${pendingCount} pending amendment(s) must be resolved before proceeding`,
        details: { pendingCount },
      };
    }
    return { allowed: true };
  } catch {
    return { allowed: true }; // Fail-open
  }
}

// ── Verdict gate ────────────────────────────

/**
 * Block merge/commit when latest audit verdict is not "approved".
 */
export function checkVerdictGate(store: EventStore): GateResult {
  try {
    const allVerdicts = store.query({ eventType: "audit.verdict", limit: 100, descending: true });
    // Filter out parliament deliberation verdicts — they are topic discussions, not code audits
    const verdicts = allVerdicts.filter(e => e.payload.mode !== "parliament");
    if (verdicts.length === 0) return { allowed: true }; // No audits yet

    const latest = verdicts[0]!;
    const verdict = latest.payload.verdict as string;

    if (verdict !== AUDIT_VERDICT.APPROVED) {
      return {
        allowed: false,
        reason: `Latest audit verdict: "${verdict}". Merge requires "approved".`,
        details: { verdict, timestamp: latest.timestamp },
      };
    }
    return { allowed: true };
  } catch {
    return { allowed: true }; // Fail-open
  }
}

// ── Confluence gate ─────────────────────────

/**
 * Block merge when latest confluence verification failed.
 */
export function checkConfluenceGate(store: EventStore): GateResult {
  try {
    const sessions = store.query({ eventType: "parliament.session.digest", limit: 5, descending: true });
    // Find latest session with confluence result (DESC → newest first)
    for (let i = 0; i < sessions.length; i++) {
      const p = sessions[i]!.payload;
      if (p.confluencePassed !== undefined) {
        if (p.confluencePassed === false) {
          return {
            allowed: false,
            reason: "Confluence verification failed. Fix mismatches before merge.",
            details: { confluencePassed: false },
          };
        }
        return { allowed: true };
      }
    }
    return { allowed: true }; // No confluence data
  } catch {
    return { allowed: true }; // Fail-open
  }
}

// ── Design gate ─────────────────────────────

/**
 * Block WB generation when design artifacts are missing.
 * Checks for at least spec.md or architecture.md in the design directory.
 */
export function checkDesignGate(planningDir: string, trackName: string): GateResult {
  const designDir = resolve(planningDir, trackName, "design");

  if (!existsSync(designDir)) {
    return {
      allowed: false,
      reason: `Design artifacts missing: ${designDir}/ does not exist. Create Design Phase documents before WB.`,
      details: { designDir, trackName },
    };
  }

  try {
    const files = readdirSync(designDir).filter(f => f.endsWith(".md"));
    if (files.length === 0) {
      return {
        allowed: false,
        reason: `Design directory exists but is empty. At minimum: spec.md + architecture.md required.`,
        details: { designDir, files: [] },
      };
    }
    return { allowed: true, details: { designDir, files } };
  } catch {
    return { allowed: true }; // Fail-open
  }
}

// ── Regression gate ─────────────────────────


/**
 * Detect if a provider's conformance stage has regressed.
 * Returns regression info if detected, null otherwise.
 */
export function detectRegression(
  previousStage: ConformanceStage,
  currentStage: ConformanceStage,
): GateResult {
  const prevIdx = STAGE_ORDER.indexOf(previousStage);
  const currIdx = STAGE_ORDER.indexOf(currentStage);

  if (currIdx < prevIdx) {
    return {
      allowed: false,
      reason: `Normal Form regression: ${previousStage} → ${currentStage}. Provider moved backward.`,
      details: { previousStage, currentStage, regressed: true },
    };
  }
  return { allowed: true };
}

// ── Combined gate ───────────────────────────

/**
 * Run all parliament gates at once (for pre-merge/pre-implementation checks).
 * Returns first failure, or allowed:true if all pass.
 */
export function checkAllGates(
  store: EventStore,
  options?: { planningDir?: string; trackName?: string },
): GateResult {
  // 1. Amendment gate
  const amendment = checkAmendmentGate(store);
  if (!amendment.allowed) return amendment;

  // 2. Verdict gate
  const verdict = checkVerdictGate(store);
  if (!verdict.allowed) return verdict;

  // 3. Confluence gate
  const confluence = checkConfluenceGate(store);
  if (!confluence.allowed) return confluence;

  // 4. Design gate (optional — only if track context provided)
  if (options?.planningDir && options?.trackName) {
    const design = checkDesignGate(options.planningDir, options.trackName);
    if (!design.allowed) return design;
  }

  return { allowed: true };
}
