/**
 * Amendment Process — legislative change management for the quorum parliament.
 *
 * Any participant can propose amendments to PRD, Design, WB, or Scope.
 * Amendments require majority vote from voting members (Advocate, Devil, Judge).
 * Implementer has testimony rights but no vote.
 *
 * All amendments are stored as parliament.amendment.* events in EventStore.
 */

import { randomUUID } from "node:crypto";
import type { EventStore } from "./store.js";
import {
  createEvent,
  AMENDMENT_STATUS,
  type AmendmentStatusType,
  type ParliamentAmendmentProposePayload,
  type ParliamentAmendmentVotePayload,
  type ParliamentRole,
} from "./events.js";

// ── Types ────────────────────────────────────

export type AmendmentTarget = "prd" | "design" | "wb" | "scope";
export type AmendmentStatus = AmendmentStatusType;
export type VotePosition = "for" | "against" | "abstain";

export interface Amendment {
  id: string;
  target: AmendmentTarget;
  change: string;
  sponsor: string;
  sponsorRole: ParliamentRole;
  justification: string;
  status: AmendmentStatus;
  votes: AmendmentVote[];
  proposedAt: number;
  resolvedAt?: number;
}

export interface AmendmentVote {
  voter: string;
  role: ParliamentRole;
  position: VotePosition;
  confidence: number;
  timestamp: number;
}

export interface AmendmentResolution {
  status: AmendmentStatus;
  votesFor: number;
  votesAgainst: number;
  abstentions: number;
  totalEligible: number;
  /** Whether quorum was met (majority of eligible voters voted). */
  quorumMet: boolean;
}

// ── Eligible voters ─────────────────────────

/** Roles with voting rights. Implementer has testimony only. */
const VOTING_ROLES: ParliamentRole[] = ["advocate", "devil", "judge", "specialist"];

// ── Amendment Manager ───────────────────────

export interface ProposeAmendmentOptions {
  target: AmendmentTarget;
  change: string;
  sponsor: string;
  sponsorRole: ParliamentRole;
  justification: string;
}

/**
 * Propose a new amendment.
 */
export function proposeAmendment(
  store: EventStore,
  options: ProposeAmendmentOptions,
): Amendment {
  const { target, change, sponsor, sponsorRole, justification } = options;
  const id = `A-${randomUUID().slice(0, 8)}`;

  const payload: ParliamentAmendmentProposePayload = {
    amendmentId: id,
    target,
    change,
    sponsor,
    justification,
  };

  store.append(createEvent("parliament.amendment.propose", "generic", {
    ...payload,
    sponsorRole,
    status: AMENDMENT_STATUS.PROPOSED,
  }));

  return {
    id,
    target,
    change,
    sponsor,
    sponsorRole,
    justification,
    status: AMENDMENT_STATUS.PROPOSED,
    votes: [],
    proposedAt: Date.now(),
  };
}

/**
 * Cast a vote on an amendment.
 * Only voting roles can vote. Implementer votes are rejected.
 */
export function voteOnAmendment(
  store: EventStore,
  amendmentId: string,
  voter: string,
  role: ParliamentRole,
  position: VotePosition,
  confidence: number,
): { success: boolean; reason?: string } {
  if (!VOTING_ROLES.includes(role)) {
    return { success: false, reason: `Role '${role}' does not have voting rights` };
  }

  const payload: ParliamentAmendmentVotePayload = {
    amendmentId,
    voter,
    position,
    confidence,
  };

  store.append(createEvent("parliament.amendment.vote", "generic", {
    ...payload,
    role,
  }));

  return { success: true };
}

/**
 * Required approval thresholds by amendment target.
 * WB = simple majority, PRD/Design = super-majority, Scope = unanimous.
 */
const APPROVAL_THRESHOLDS: Record<AmendmentTarget, number> = {
  wb: 0.5,       // >50% — tactical change
  prd: 0.66,     // ≥66% — changes what we're building
  design: 0.66,  // ≥66% — changes how we're building
  scope: 1.0,    // 100% — changes project boundary
};

/**
 * Resolve an amendment: count votes and determine outcome.
 * Threshold depends on amendment target (parliament-rules §2).
 */
export function resolveAmendment(
  store: EventStore,
  amendmentId: string,
  totalEligibleVoters: number,
  prefetchedVotes?: Array<{ payload: Record<string, unknown> }>,
  amendmentTarget?: AmendmentTarget,
): AmendmentResolution {
  const voteEvents = prefetchedVotes
    ?? store.query({ eventType: "parliament.amendment.vote" })
        .filter(e => e.payload.amendmentId === amendmentId);

  // Deduplicate: last vote per voter wins
  const latestVotes = new Map<string, { position: VotePosition; confidence: number }>();
  for (const e of voteEvents) {
    latestVotes.set(e.payload.voter as string, {
      position: e.payload.position as VotePosition,
      confidence: e.payload.confidence as number,
    });
  }

  let votesFor = 0;
  let votesAgainst = 0;
  let abstentions = 0;

  for (const vote of latestVotes.values()) {
    if (vote.position === "for") votesFor++;
    else if (vote.position === "against") votesAgainst++;
    else abstentions++;
  }

  const totalVoted = votesFor + votesAgainst;
  const quorumMet = totalVoted > totalEligibleVoters / 2;
  const threshold = APPROVAL_THRESHOLDS[amendmentTarget ?? "wb"];
  const approved = quorumMet && totalVoted > 0 && (votesFor / totalVoted) >= threshold;

  const status: AmendmentStatus = approved ? AMENDMENT_STATUS.APPROVED : quorumMet ? AMENDMENT_STATUS.REJECTED : AMENDMENT_STATUS.DEFERRED;

  store.append(createEvent("parliament.amendment.resolve", "generic", {
    amendmentId,
    status,
    approved,
    votesFor,
    votesAgainst,
  }));

  return {
    status,
    votesFor,
    votesAgainst,
    abstentions,
    totalEligible: totalEligibleVoters,
    quorumMet,
  };
}

/**
 * Get all amendments from EventStore.
 */
export function getAmendments(store: EventStore): Amendment[] {
  const proposeEvents = store.query({ eventType: "parliament.amendment.propose" });
  const voteEvents = store.query({ eventType: "parliament.amendment.vote" });
  const resolveEvents = store.query({ eventType: "parliament.amendment.resolve" });

  // Build resolve status map
  const resolvedStatus = new Map<string, AmendmentStatus>();
  for (const e of resolveEvents) {
    resolvedStatus.set(e.payload.amendmentId as string, e.payload.status as AmendmentStatus);
  }

  // Group votes by amendment
  const votesByAmendment = new Map<string, AmendmentVote[]>();
  for (const e of voteEvents) {
    const id = e.payload.amendmentId as string;
    const votes = votesByAmendment.get(id) ?? [];
    votes.push({
      voter: e.payload.voter as string,
      role: e.payload.role as ParliamentRole,
      position: e.payload.position as VotePosition,
      confidence: e.payload.confidence as number,
      timestamp: e.timestamp,
    });
    votesByAmendment.set(id, votes);
  }

  return proposeEvents.map(e => {
    const id = e.payload.amendmentId as string;
    return {
      id,
      target: e.payload.target as AmendmentTarget,
      change: e.payload.change as string,
      sponsor: e.payload.sponsor as string,
      sponsorRole: e.payload.sponsorRole as ParliamentRole,
      justification: e.payload.justification as string,
      status: resolvedStatus.get(id) ?? AMENDMENT_STATUS.PROPOSED,
      votes: votesByAmendment.get(id) ?? [],
      proposedAt: e.timestamp,
    };
  });
}

/** Count amendments still in "proposed" status. Lightweight — skips vote queries. */
export function getPendingAmendmentCount(store: EventStore): number {
  const proposed = store.query({ eventType: "parliament.amendment.propose", limit: 500 });
  const resolved = new Set(
    store.query({ eventType: "parliament.amendment.resolve", limit: 500 })
      .map(e => e.payload.amendmentId as string),
  );
  return proposed.filter(e => !resolved.has(e.payload.amendmentId as string)).length;
}
