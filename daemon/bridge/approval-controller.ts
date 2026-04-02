/**
 * Approval Controller — routes remote approval decisions through the gate.
 *
 * Core invariant: remote decisions ALWAYS go through ProviderApprovalGate.
 * The bridge never directly modifies provider runtime state.
 *
 * Auth model:
 * - v1 uses HMAC signature on (requestId + decision + timestamp)
 * - Key is derived from a shared secret configured in daemon config
 * - Unsigned requests are rejected (fail-closed)
 *
 * @module daemon/bridge/approval-controller
 * @since RAI-2
 * @experimental Not part of v0.6.0 simplified flow — retained for future integration.
 */

import type { SessionLedger } from "../../platform/providers/session-ledger.js";
import type { BridgeControlMessage, PendingAction } from "./server.js";
import { mapApprovalToPendingAction } from "./server.js";

// ── Types ────────────────────────────────────

export interface ApprovalCallbackResult {
  success: boolean;
  requestId: string;
  decision?: "allow" | "deny";
  reason: string;
}

export interface ApprovalControllerOptions {
  /** Shared secret for HMAC verification. Empty = reject all remote. */
  sharedSecret: string;
  /** Max age for a callback (ms). Default: 30s. */
  maxCallbackAgeMs?: number;
}

// ── Controller ───────────────────────────────

export class ApprovalController {
  private readonly maxAge: number;

  constructor(
    private readonly ledger: SessionLedger,
    private readonly options: ApprovalControllerOptions,
  ) {
    this.maxAge = options.maxCallbackAgeMs ?? 30_000;
  }

  /**
   * Handle a remote approval/deny control message.
   *
   * Validates:
   * 1. requestId is present
   * 2. Timestamp is within max age (replay protection)
   * 3. Signature is valid (HMAC)
   * 4. Request is actually pending in the ledger
   *
   * Then resolves through the ledger (which the gate reads).
   */
  handleCallback(msg: BridgeControlMessage): ApprovalCallbackResult {
    if (msg.type !== "approve" && msg.type !== "deny") {
      return { success: false, requestId: msg.requestId ?? "", reason: `unsupported type: ${msg.type}` };
    }

    const requestId = msg.requestId;
    if (!requestId) {
      return { success: false, requestId: "", reason: "missing requestId" };
    }

    // Replay protection: reject old messages
    const age = Date.now() - msg.ts;
    if (age > this.maxAge) {
      return { success: false, requestId, reason: `callback too old: ${Math.round(age / 1000)}s > ${Math.round(this.maxAge / 1000)}s` };
    }
    if (age < -5000) {
      // Future timestamp (clock skew tolerance: 5s)
      return { success: false, requestId, reason: "callback timestamp in future" };
    }

    if (!this.verifySignature(msg)) {
      return { success: false, requestId, reason: "invalid signature" };
    }

    const decision = msg.type === "approve" ? "allow" : "deny";
    try {
      this.ledger.resolveApproval(requestId, decision);
    } catch (err) {
      return { success: false, requestId, reason: `ledger error: ${(err as Error).message}` };
    }

    return { success: true, requestId, decision, reason: "resolved" };
  }

  /**
   * Cancel a pending approval (e.g., session terminated).
   * Resolves as "deny" in the ledger.
   */
  cancelApproval(requestId: string): ApprovalCallbackResult {
    try {
      this.ledger.resolveApproval(requestId, "deny");
      return { success: true, requestId, decision: "deny", reason: "cancelled" };
    } catch (err) {
      return { success: false, requestId, reason: `cancel failed: ${(err as Error).message}` };
    }
  }

  /**
   * Get all pending approvals for remote UI display.
   * Returns serialized PendingAction objects.
   */
  listPending(providerSessionId: string): PendingAction[] {
    const approvals = this.ledger.pendingApprovals(providerSessionId);
    return approvals.map(a => mapApprovalToPendingAction(
      a,
      a.providerRef?.provider ?? "unknown",
      a.providerRef?.providerSessionId ?? "",
    ));
  }

  // ── Auth ──────────────────────────────────

  /**
   * Verify HMAC signature on a control message.
   *
   * v1 signature scheme:
   * - payload = `${requestId}:${decision}:${ts}`
   * - signature = HMAC-SHA256(sharedSecret, payload) as hex
   *
   * Empty shared secret = reject all remote (secure default).
   */
  private verifySignature(msg: BridgeControlMessage): boolean {
    if (!this.options.sharedSecret) return false;
    if (!msg.signature) return false;

    const payload = `${msg.requestId}:${msg.type}:${msg.ts}`;
    const expected = computeHmac(this.options.sharedSecret, payload);
    return timingSafeEqual(expected, msg.signature);
  }
}

// ── Crypto Helpers ───────────────────────────

// Node.js crypto loaded at module init (top-level await in ESM)
import { createHmac, timingSafeEqual as tsEqual } from "node:crypto";

/**
 * Compute HMAC-SHA256 as hex string.
 */
function computeHmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Timing-safe string comparison to prevent timing attacks on HMAC.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return tsEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generate an HMAC signature for a control message (used by remote clients).
 * Exported for testing and client SDK use.
 */
export function signControlMessage(
  secret: string,
  requestId: string,
  decision: "approve" | "deny",
  ts: number,
): string {
  return computeHmac(secret, `${requestId}:${decision}:${ts}`);
}
