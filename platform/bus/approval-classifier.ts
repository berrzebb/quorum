/**
 * Approval Classifier — risk-based classification for approval requests.
 *
 * Adopted from Claude Code bashPermissions.ts / PermissionContext.ts patterns:
 * classifies approval requests into risk buckets BEFORE the gate evaluates them.
 *
 * Key invariant: the classifier is ADVISORY. It never has final authority.
 * - Shadow mode: records classification without affecting gate behavior.
 * - Enforce mode (future RTI-8): only `auto-allow` for safe buckets;
 *   high-risk buckets ALWAYS go through the gate.
 *
 * Core safety rule: destructive/network/diff high-risk requests
 * can NEVER receive an `auto-allow` classification.
 *
 * @module bus/approval-classifier
 */

import type { ApprovalTelemetryRecord } from "./provider-approval-gate.js";

// ── Risk Buckets ────────────────────────────────────

export type RiskBucket = "auto-allow" | "auto-deny" | "needs-human";

/** Classifier output for a single approval request. */
export interface ClassifierDecision {
  /** Risk bucket assignment. */
  bucket: RiskBucket;
  /** Confidence in the classification (0.0 - 1.0). */
  confidence: number;
  /** Human-readable reason for the classification. */
  reason: string;
  /** Recommended gate decision (advisory only). */
  recommendedDecision: "allow" | "deny";
  /** Risk signals detected. */
  signals: RiskSignal[];
}

/** Individual risk signal detected in the request. */
export interface RiskSignal {
  name: string;
  weight: number;
  value: boolean;
}

// ── Classifier Input ────────────────────────────────

/** Normalized input for classification (mirrors ApprovalTelemetryRecord shape). */
export interface ClassifierInput {
  tool: string;
  kind: "tool" | "command" | "diff" | "network";
  readOnly: boolean;
  destructive: boolean;
  network: boolean;
  diff: boolean;
  /** Additional context from capability registry. */
  concurrencySafe?: boolean;
  category?: string;
}

// ── Pure Heuristic Classifier ───────────────────────

/**
 * High-risk signal names that BLOCK auto-allow.
 * If ANY of these are true, the bucket cannot be `auto-allow`.
 */
const HIGH_RISK_SIGNALS = new Set(["destructive", "network", "diff"]);

/**
 * Classify an approval request into a risk bucket.
 *
 * This is a PURE FUNCTION — no side effects, no state, no I/O.
 * Can be replayed against telemetry records for calibration.
 *
 * Core safety invariant: if any high-risk signal is true,
 * the bucket is NEVER `auto-allow`.
 */
export function classify(input: ClassifierInput): ClassifierDecision {
  const signals: RiskSignal[] = [
    { name: "readOnly", weight: -0.3, value: input.readOnly },
    { name: "destructive", weight: 0.5, value: input.destructive },
    { name: "network", weight: 0.4, value: input.network },
    { name: "diff", weight: 0.3, value: input.diff },
    { name: "concurrencySafe", weight: -0.1, value: input.concurrencySafe ?? false },
  ];

  // Check high-risk signals
  const hasHighRisk = signals.some(
    s => HIGH_RISK_SIGNALS.has(s.name) && s.value,
  );

  // Compute risk score (higher = more risky)
  const riskScore = signals.reduce(
    (sum, s) => sum + (s.value ? s.weight : 0),
    0,
  );

  // Classification logic
  if (hasHighRisk) {
    // High-risk: NEVER auto-allow
    if (input.destructive) {
      return {
        bucket: "auto-deny",
        confidence: 0.95,
        reason: `Destructive tool "${input.tool}" — auto-deny`,
        recommendedDecision: "deny",
        signals,
      };
    }
    return {
      bucket: "needs-human",
      confidence: 0.85,
      reason: `High-risk signal detected for "${input.tool}" (${
        input.network ? "network" : "diff"
      })`,
      recommendedDecision: "deny",
      signals,
    };
  }

  // Read-only tool with no risk signals → safe to auto-allow
  if (input.readOnly && riskScore <= -0.2) {
    return {
      bucket: "auto-allow",
      confidence: 0.9,
      reason: `Read-only tool "${input.tool}" with no risk signals`,
      recommendedDecision: "allow",
      signals,
    };
  }

  // Low risk but not read-only → needs human judgment
  if (riskScore <= 0) {
    return {
      bucket: "auto-allow",
      confidence: 0.7,
      reason: `Low-risk tool "${input.tool}" (score: ${riskScore.toFixed(2)})`,
      recommendedDecision: "allow",
      signals,
    };
  }

  // Default: needs human
  return {
    bucket: "needs-human",
    confidence: 0.6,
    reason: `Moderate risk for "${input.tool}" (score: ${riskScore.toFixed(2)})`,
    recommendedDecision: "deny",
    signals,
  };
}

/**
 * Convert a telemetry record to classifier input (for replay).
 */
export function telemetryToInput(record: ApprovalTelemetryRecord): ClassifierInput {
  return {
    tool: record.tool,
    kind: record.kind,
    readOnly: record.readOnly,
    destructive: record.destructive,
    network: record.network,
    diff: record.diff,
  };
}

/**
 * Validate the core safety invariant: no high-risk request gets auto-allow.
 * Returns true if the invariant holds.
 */
export function validateSafetyInvariant(input: ClassifierInput, decision: ClassifierDecision): boolean {
  const isHighRisk = input.destructive || input.network || input.diff;
  if (isHighRisk && decision.bucket === "auto-allow") {
    return false; // INVARIANT VIOLATION
  }
  return true;
}
