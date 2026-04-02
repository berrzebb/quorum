#!/usr/bin/env node
/**
 * LOOP-1: Simple Audit Interface Tests
 *
 * Verifies that the v0.6.0 simplified audit interface works:
 * - runAudit() uses a single auditor (judge only)
 * - runParliamentAudit() uses 3-role deliberation
 * - selectAuditMode() selects based on --parliament flag
 * - createSingleAuditor() returns one auditor
 *
 * Run: node --test tests/simple-audit.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { runAudit, runParliamentAudit, selectAuditMode } = await import(
  "../dist/platform/providers/consensus.js"
);
const { createSingleAuditor, createConsensusAuditors } = await import(
  "../dist/platform/providers/auditors/factory.js"
);

// ═══ Mock auditor ═══════════════════════════════════════════════════════

function createMockAuditor(verdict = "approved", name = "mock") {
  let callCount = 0;
  return {
    name,
    get calls() { return callCount; },
    async audit(_request) {
      callCount++;
      return {
        verdict,
        codes: verdict === "approved" ? [] : ["test-issue"],
        summary: `${name} verdict: ${verdict}`,
        raw: JSON.stringify({ verdict }),
        duration: 10,
      };
    },
    async available() { return true; },
  };
}

// ═══ 1. selectAuditMode ═════════════════════════════════════════════════

describe("selectAuditMode", () => {
  it("returns 'single' when no parliament flag", () => {
    assert.equal(selectAuditMode({}), "single");
  });

  it("returns 'single' when parliament is false", () => {
    assert.equal(selectAuditMode({ parliament: false }), "single");
  });

  it("returns 'parliament' when parliament is true", () => {
    assert.equal(selectAuditMode({ parliament: true }), "parliament");
  });
});

// ═══ 2. runAudit — single model ════════════════════════════════════════

describe("runAudit — single cross-model review", () => {
  it("returns pass=true for approved verdict", async () => {
    const auditor = createMockAuditor("approved", "judge-model");
    const result = await runAudit(auditor, { prompt: "test" }, "judge-model");

    assert.equal(result.pass, true);
    assert.deepEqual(result.findings, []);
    assert.equal(result.model, "judge-model");
    assert.equal(auditor.calls, 1, "should call auditor exactly once");
  });

  it("returns pass=false for changes_requested verdict", async () => {
    const auditor = createMockAuditor("changes_requested", "judge-model");
    const result = await runAudit(auditor, { prompt: "test" }, "judge-model");

    assert.equal(result.pass, false);
    assert.ok(result.findings.length > 0);
    assert.equal(auditor.calls, 1);
  });

  it("returns pass=false on auditor error", async () => {
    const badAuditor = {
      async audit() { throw new Error("connection timeout"); },
      async available() { return false; },
    };
    const result = await runAudit(badAuditor, { prompt: "test" }, "broken-model");

    assert.equal(result.pass, false);
    assert.ok(result.findings[0].includes("connection timeout"));
  });
});

// ═══ 3. runParliamentAudit — 3 roles ═══════════════════════════════════

describe("runParliamentAudit — 3-role deliberation", () => {
  it("calls all 3 roles (advocate + devil + judge)", async () => {
    const advocate = createMockAuditor("approved", "advocate");
    const devil = createMockAuditor("approved", "devil");
    const judge = createMockAuditor("approved", "judge");

    const config = { advocate, devil, judge };
    const result = await runParliamentAudit(config, { prompt: "test" }, "parliament");

    assert.equal(result.pass, true);
    assert.equal(advocate.calls, 1, "advocate should be called");
    assert.equal(devil.calls, 1, "devil should be called");
    assert.equal(judge.calls, 1, "judge should be called");
  });
});

// ═══ 4. createSingleAuditor ════════════════════════════════════════════

// ═══ 4. Audit mode integration ═════════════════════════════════════════

describe("Audit mode integration", () => {
  it("single mode calls only one auditor", async () => {
    const advocate = createMockAuditor("approved", "adv");
    const devil = createMockAuditor("approved", "dev");
    const judge = createMockAuditor("approved", "jdg");

    const mode = selectAuditMode({ parliament: false });
    assert.equal(mode, "single");

    // In single mode, only the judge auditor is used
    const result = await runAudit(judge, { prompt: "test" }, "jdg");
    assert.equal(result.pass, true);
    assert.equal(judge.calls, 1);
    assert.equal(advocate.calls, 0, "advocate should NOT be called in single mode");
    assert.equal(devil.calls, 0, "devil should NOT be called in single mode");
  });

  it("parliament mode calls all 3 roles", async () => {
    const advocate = createMockAuditor("approved", "adv");
    const devil = createMockAuditor("approved", "dev");
    const judge = createMockAuditor("approved", "jdg");

    const mode = selectAuditMode({ parliament: true });
    assert.equal(mode, "parliament");

    const config = { advocate, devil, judge };
    const result = await runParliamentAudit(config, { prompt: "test" }, "parliament");
    assert.equal(result.pass, true);
    assert.equal(advocate.calls, 1, "advocate MUST be called in parliament mode");
    assert.equal(devil.calls, 1, "devil MUST be called in parliament mode");
    assert.equal(judge.calls, 1, "judge MUST be called in parliament mode");
  });
});

// ═══ 5. createSingleAuditor ════════════════════════════════════════════

describe("createSingleAuditor", () => {
  it("creates one auditor using judge role", () => {
    // This will throw because "mock" is not a real provider,
    // but we can test createConsensusAuditors creates 3 vs createSingleAuditor creates 1
    const roles = { advocate: "claude", devil: "codex", judge: "claude" };

    const consensus = createConsensusAuditors(roles);
    assert.ok(consensus.advocate);
    assert.ok(consensus.devil);
    assert.ok(consensus.judge);

    const single = createSingleAuditor(roles);
    assert.ok(single);
    assert.ok(typeof single.audit === "function");
  });

  it("falls back to default when judge not specified", () => {
    const single = createSingleAuditor({ default: "claude" });
    assert.ok(single);
  });
});
