#!/usr/bin/env node
/**
 * Amendment Tests — propose, vote, resolve, and query amendments.
 *
 * Run: node --test tests/amendment.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { EventStore } = await import("../dist/platform/bus/store.js");
const {
  proposeAmendment,
  voteOnAmendment,
  resolveAmendment,
  getAmendments,
} = await import("../dist/platform/bus/amendment.js");

/** Helper: fresh in-memory store per test. */
function createStore() {
  return new EventStore({ dbPath: ":memory:" });
}

// ═══ 1. proposeAmendment ═══════════════════════════════════════════════

describe("proposeAmendment", () => {
  it("creates amendment and stores event", () => {
    const store = createStore();

    const amendment = proposeAmendment(store, {
      target: "design", change: "Add caching layer", sponsor: "agent-1", sponsorRole: "advocate", justification: "Reduces latency by 50%",
    });

    assert.ok(amendment.id.startsWith("A-"));
    assert.equal(amendment.target, "design");
    assert.equal(amendment.change, "Add caching layer");
    assert.equal(amendment.sponsor, "agent-1");
    assert.equal(amendment.sponsorRole, "advocate");
    assert.equal(amendment.justification, "Reduces latency by 50%");
    assert.equal(amendment.status, "proposed");
    assert.deepEqual(amendment.votes, []);

    // Verify event stored in SQLite
    const events = store.query({ eventType: "parliament.amendment.propose" });
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.amendmentId, amendment.id);
    assert.equal(events[0].payload.target, "design");

    store.close();
  });
});

// ═══ 2. voteOnAmendment ═══════════════════════════════════════════════

describe("voteOnAmendment", () => {
  it("voting role succeeds", () => {
    const store = createStore();

    const amendment = proposeAmendment(store, {
      target: "prd", change: "Expand scope", sponsor: "agent-1", sponsorRole: "advocate", justification: "User feedback",
    });

    const result = voteOnAmendment(store, amendment.id, "agent-2", "judge", "for", 0.9);

    assert.equal(result.success, true);
    assert.equal(result.reason, undefined);

    // Verify vote event stored
    const votes = store.query({ eventType: "parliament.amendment.vote" });
    assert.equal(votes.length, 1);
    assert.equal(votes[0].payload.amendmentId, amendment.id);
    assert.equal(votes[0].payload.voter, "agent-2");
    assert.equal(votes[0].payload.position, "for");

    store.close();
  });

  it("implementer role is rejected", () => {
    const store = createStore();

    const amendment = proposeAmendment(store, {
      target: "wb", change: "Split task 3", sponsor: "agent-1", sponsorRole: "advocate", justification: "Too large",
    });

    const result = voteOnAmendment(store, amendment.id, "agent-impl", "implementer", "for", 0.8);

    assert.equal(result.success, false);
    assert.ok(result.reason.includes("implementer"));
    assert.ok(result.reason.includes("voting rights"));

    // No vote event should be stored
    const votes = store.query({ eventType: "parliament.amendment.vote" });
    assert.equal(votes.length, 0);

    store.close();
  });
});

// ═══ 3. resolveAmendment ══════════════════════════════════════════════

describe("resolveAmendment", () => {
  it("2 for, 1 against (3 eligible) → approved", () => {
    const store = createStore();

    const amendment = proposeAmendment(store, {
      target: "design", change: "New API pattern", sponsor: "agent-1", sponsorRole: "advocate", justification: "Better DX",
    });

    voteOnAmendment(store, amendment.id, "agent-adv", "advocate", "for", 0.9);
    voteOnAmendment(store, amendment.id, "agent-judge", "judge", "for", 0.85);
    voteOnAmendment(store, amendment.id, "agent-devil", "devil", "against", 0.7);

    const resolution = resolveAmendment(store, amendment.id, 3);

    assert.equal(resolution.status, "approved");
    assert.equal(resolution.votesFor, 2);
    assert.equal(resolution.votesAgainst, 1);
    assert.equal(resolution.abstentions, 0);
    assert.equal(resolution.totalEligible, 3);
    assert.equal(resolution.quorumMet, true);

    store.close();
  });

  it("1 for, 2 against → rejected", () => {
    const store = createStore();

    const amendment = proposeAmendment(store, {
      target: "scope", change: "Remove feature X", sponsor: "agent-1", sponsorRole: "devil", justification: "Too complex",
    });

    voteOnAmendment(store, amendment.id, "agent-adv", "advocate", "against", 0.8);
    voteOnAmendment(store, amendment.id, "agent-judge", "judge", "against", 0.75);
    voteOnAmendment(store, amendment.id, "agent-spec", "specialist", "for", 0.6);

    const resolution = resolveAmendment(store, amendment.id, 3);

    assert.equal(resolution.status, "rejected");
    assert.equal(resolution.votesFor, 1);
    assert.equal(resolution.votesAgainst, 2);
    assert.equal(resolution.abstentions, 0);
    assert.equal(resolution.quorumMet, true);

    store.close();
  });

  it("only 1 vote of 3 eligible → deferred (quorum not met)", () => {
    const store = createStore();

    const amendment = proposeAmendment(store, {
      target: "prd", change: "Add requirement", sponsor: "agent-1", sponsorRole: "judge", justification: "Missing coverage",
    });

    voteOnAmendment(store, amendment.id, "agent-adv", "advocate", "for", 0.9);

    const resolution = resolveAmendment(store, amendment.id, 3);

    assert.equal(resolution.status, "deferred");
    assert.equal(resolution.votesFor, 1);
    assert.equal(resolution.votesAgainst, 0);
    assert.equal(resolution.quorumMet, false);

    store.close();
  });
});

// ═══ 4. getAmendments ═════════════════════════════════════════════════

describe("getAmendments", () => {
  it("returns all amendments with grouped votes", () => {
    const store = createStore();

    const a1 = proposeAmendment(store, {
      target: "design", change: "Change A", sponsor: "agent-1", sponsorRole: "advocate", justification: "Reason A",
    });
    const a2 = proposeAmendment(store, {
      target: "wb", change: "Change B", sponsor: "agent-2", sponsorRole: "devil", justification: "Reason B",
    });

    // Votes on first amendment
    voteOnAmendment(store, a1.id, "agent-judge", "judge", "for", 0.9);
    voteOnAmendment(store, a1.id, "agent-devil", "devil", "against", 0.7);

    // Vote on second amendment
    voteOnAmendment(store, a2.id, "agent-adv", "advocate", "for", 0.8);

    const amendments = getAmendments(store);

    assert.equal(amendments.length, 2);

    // First amendment
    const first = amendments.find(a => a.id === a1.id);
    assert.ok(first);
    assert.equal(first.target, "design");
    assert.equal(first.change, "Change A");
    assert.equal(first.sponsor, "agent-1");
    assert.equal(first.sponsorRole, "advocate");
    assert.equal(first.votes.length, 2);

    // Second amendment
    const second = amendments.find(a => a.id === a2.id);
    assert.ok(second);
    assert.equal(second.target, "wb");
    assert.equal(second.change, "Change B");
    assert.equal(second.votes.length, 1);
    assert.equal(second.votes[0].voter, "agent-adv");

    store.close();
  });
});
