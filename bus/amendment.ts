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
  type ParliamentAmendmentProposePayload,
  type ParliamentAmendmentVotePayload,
  type ParliamentRole,
} from "./events.js";

// ── Types ────────────────────────────────────

export type AmendmentTarget = "prd" | "design" | "wb" | "scope";
export type AmendmentStatus = "proposed" | "approved" | "rejected" | "deferred";
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
    status: "proposed",
  }));

  return {
    id,
    target,
    change,
    sponsor,
    sponsorRole,
    justification,
    status: "proposed",
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
 * Resolve an amendment: count votes and determine outcome.
 * Requires majority (>50%) of eligible voters to approve.
 */
export function resolveAmendment(
  store: EventStore,
  amendmentId: string,
  totalEligibleVoters: number,
): AmendmentResolution {
  // TODO: EventStore.query() only supports eventType filter — no payload-level indexing.
  // If amendment volume grows, add a SQLite index on payload->>'amendmentId' or use aggregateId.
  const voteEvents = store.query({ eventType: "parliament.amendment.vote" })
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
  const approved = quorumMet && votesFor > votesAgainst;

  const status: AmendmentStatus = approved ? "approved" : quorumMet ? "rejected" : "deferred";

  store.append(createEvent("parliament.amendment.resolve", "generic", {
    amendmentId,
    status,
    approved,
    votesFor,
    votesAgainst,
  } as unknown as Record<string, unknown>));

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

  return proposeEvents.map(e => ({
    id: e.payload.amendmentId as string,
    target: e.payload.target as AmendmentTarget,
    change: e.payload.change as string,
    sponsor: e.payload.sponsor as string,
    sponsorRole: e.payload.sponsorRole as ParliamentRole,
    justification: e.payload.justification as string,
    status: (e.payload.status as AmendmentStatus) ?? "proposed",
    votes: votesByAmendment.get(e.payload.amendmentId as string) ?? [],
    proposedAt: e.timestamp,
  }));
}
