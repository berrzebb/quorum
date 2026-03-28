#!/usr/bin/env node
/**
 * Phase 5 Tests: Dynamic Specialist Spawn + Context Revival + Agent Sync Queries
 *
 * Run: node --test tests/agent-comm.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";

import { createTempStore, cleanup } from "./helpers.mjs";

const { MessageBus } = await import("../dist/platform/bus/message-bus.js");
const { detectMissingSpecialists } = await import("../dist/platform/providers/specialist.js");

// ═══ 1. Dynamic Specialist Spawn ═══════════════════════════════

describe("Dynamic Specialist Spawn", () => {
  it("detects missing compliance specialist from finding keywords", () => {
    const findings = [
      { category: "security", description: "PII exposure in user data endpoint", file: "api/users.ts", reviewerId: "code-reviewer" },
    ];
    const activeDomains = new Set(["performance"]);
    const candidates = detectMissingSpecialists(findings, activeDomains);

    assert.ok(candidates.some(c => c.domain === "compliance"));
    assert.equal(candidates[0].trigger, "finding");
    assert.equal(candidates[0].parentReviewerId, "code-reviewer");
  });

  it("skips already active domains", () => {
    const findings = [
      { category: "query", description: "N+1 slow query in getUserOrders", reviewerId: "reviewer-A" },
    ];
    const activeDomains = new Set(["performance"]);
    const candidates = detectMissingSpecialists(findings, activeDomains);

    assert.ok(!candidates.some(c => c.domain === "performance"));
  });

  it("detects multiple missing domains at once", () => {
    const findings = [
      { category: "security", description: "credential token exposure in logs", reviewerId: "r1" },
      { category: "code", description: "race condition on shared state update", reviewerId: "r2" },
    ];
    const activeDomains = new Set([]);
    const candidates = detectMissingSpecialists(findings, activeDomains);

    const domains = candidates.map(c => c.domain);
    assert.ok(domains.includes("compliance"));
    assert.ok(domains.includes("concurrency"));
  });

  it("returns empty when all domains covered", () => {
    const findings = [
      { category: "perf", description: "slow query detected", reviewerId: "r1" },
    ];
    const activeDomains = new Set(["performance", "compliance", "concurrency", "migration", "accessibility", "observability", "i18n", "infrastructure"]);
    const candidates = detectMissingSpecialists(findings, activeDomains);
    assert.equal(candidates.length, 0);
  });

  it("returns empty for irrelevant keywords", () => {
    const findings = [
      { category: "style", description: "use consistent indentation", reviewerId: "r1" },
    ];
    const activeDomains = new Set([]);
    const candidates = detectMissingSpecialists(findings, activeDomains);
    assert.equal(candidates.length, 0);
  });
});

// ═══ 2. Context Revival ═══════════════════════════════════════

describe("Context Revival", () => {
  let store, dir, bus;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    bus = new MessageBus(store);
  });

  it("saves and restores context", () => {
    // Submit some findings first
    bus.submitFindings([
      { reviewerId: "r1", provider: "codex", severity: "major", category: "bug", description: "null pointer" },
    ], "claude-code", "r1", "codex");

    bus.saveContext("session-1", "agent-A", ["TN-1", "TN-2"], 3);

    const restored = bus.restoreContext("agent-A");
    assert.ok(restored);
    assert.equal(restored.round, 3);
    assert.deepEqual(restored.pendingItems, ["TN-1", "TN-2"]);
    assert.ok(restored.summary.includes("Round 3"));
    assert.ok(restored.openFindings.length > 0);
    assert.ok(restored.savedAt > 0);
  });

  it("returns null for unknown agent", () => {
    const restored = bus.restoreContext("unknown-agent");
    assert.equal(restored, null);
  });

  it("summary includes open findings", () => {
    bus.submitFindings([
      { reviewerId: "r1", provider: "codex", severity: "critical", category: "security", description: "SQL injection vulnerability" },
      { reviewerId: "r1", provider: "codex", severity: "minor", category: "style", description: "trailing whitespace" },
    ], "claude-code", "r1", "codex");

    bus.saveContext("s1", "agent-B", [], 5);
    const restored = bus.restoreContext("agent-B");
    assert.ok(restored.summary.includes("2 total"));
    assert.ok(restored.summary.includes("2 open"));
  });

  it("overwrites previous save for same agent", () => {
    bus.saveContext("s1", "agent-C", ["TN-1"], 1);
    bus.saveContext("s2", "agent-C", ["TN-2", "TN-3"], 5);

    const restored = bus.restoreContext("agent-C");
    assert.equal(restored.round, 5);
    assert.deepEqual(restored.pendingItems, ["TN-2", "TN-3"]);
  });

  it("emits context.save event", () => {
    bus.saveContext("s1", "agent-D", [], 2);
    const events = store.query({ eventType: "context.save" });
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.agentId, "agent-D");
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});

// ═══ 3. Agent-to-Agent Sync Queries ══════════════════════════

describe("Agent Sync Queries", () => {
  let store, dir, bus;

  beforeEach(() => {
    ({ store, dir } = createTempStore());
    bus = new MessageBus(store);
  });

  it("posts query and gets queryId", () => {
    const qid = bus.postQuery("advocate", "What's the security impact of this change?");
    assert.ok(qid.startsWith("Q-"));
  });

  it("respondToQuery stores response", () => {
    const qid = bus.postQuery("advocate", "Is this a breaking change?");
    bus.respondToQuery(qid, "devil", "Yes, the API signature changed", "claude-code", 0.9);

    const responses = bus.getResponses(qid);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].fromAgent, "devil");
    assert.equal(responses[0].confidence, 0.9);
    assert.ok(responses[0].answer.includes("API signature"));
  });

  it("pollQueries returns unanswered queries for target agent", () => {
    bus.postQuery("advocate", "What do you think?", "claude-code", "devil");
    bus.postQuery("advocate", "Another question", "claude-code", "judge");

    const devilQueries = bus.pollQueries("devil");
    assert.equal(devilQueries.length, 1);
    assert.equal(devilQueries[0].question, "What do you think?");

    const judgeQueries = bus.pollQueries("judge");
    assert.equal(judgeQueries.length, 1);
    assert.equal(judgeQueries[0].question, "Another question");
  });

  it("broadcast queries appear for all agents", () => {
    bus.postQuery("advocate", "General question for everyone");

    const devilQ = bus.pollQueries("devil");
    const judgeQ = bus.pollQueries("judge");
    assert.equal(devilQ.length, 1);
    assert.equal(judgeQ.length, 1);
  });

  it("answered queries disappear from poll", () => {
    const qid = bus.postQuery("advocate", "Need your input");
    assert.equal(bus.pollQueries("devil").length, 1);

    bus.respondToQuery(qid, "devil", "Here's my answer");
    assert.equal(bus.pollQueries("devil").length, 0);
  });

  it("own queries don't appear in poll", () => {
    bus.postQuery("advocate", "My own question");
    const selfQueries = bus.pollQueries("advocate");
    assert.equal(selfQueries.length, 0);
  });

  it("multiple responses to same query", () => {
    const qid = bus.postQuery("judge", "Both of you, defend your position");

    bus.respondToQuery(qid, "advocate", "I support this change");
    bus.respondToQuery(qid, "devil", "I oppose this change", "claude-code", 0.8);

    const responses = bus.getResponses(qid);
    assert.equal(responses.length, 2);
  });

  it("queries include context", () => {
    const qid = bus.postQuery(
      "advocate", "Check this file",
      "claude-code", "devil",
      { file: "src/auth.ts", line: 42 },
    );

    const queries = bus.pollQueries("devil");
    assert.deepEqual(queries[0].context, { file: "src/auth.ts", line: 42 });
  });

  it("cleanup", () => {
    store.close();
    cleanup(dir);
  });
});
