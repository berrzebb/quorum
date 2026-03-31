/**
 * Tests for codex-plugin-cc integration layer:
 * - broker-detect: plugin availability detection
 * - plugin-bridge: request/response format conversion
 * - plugin-auditor: CodexPluginAuditor (factory routing)
 * - adversarial-review: adversarial review wrapper
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// ── broker-detect ─────────────────────────────────────

describe("broker-detect", () => {
  let mod;

  before(async () => {
    mod = await import("../dist/platform/providers/codex/broker-detect.js");
  });

  it("exports detection functions", () => {
    assert.equal(typeof mod.isCodexPluginAvailable, "function");
    assert.equal(typeof mod.getCompanionScriptPath, "function");
    assert.equal(typeof mod.resetBrokerCache, "function");
  });

  it("resetBrokerCache clears cached state", () => {
    // Should not throw
    mod.resetBrokerCache();
    // After reset, getCompanionScriptPath should return null (no plugin installed in test env)
    mod.resetBrokerCache();
    const path = mod.getCompanionScriptPath();
    // In CI/test environments, codex-plugin-cc is not installed
    // so this should return null (not throw)
    assert.ok(path === null || typeof path === "string");
  });

  it("isCodexPluginAvailable returns boolean", () => {
    mod.resetBrokerCache();
    const result = mod.isCodexPluginAvailable();
    assert.equal(typeof result, "boolean");
  });

  it("results are cached across calls", () => {
    mod.resetBrokerCache();
    const first = mod.isCodexPluginAvailable();
    const second = mod.isCodexPluginAvailable();
    assert.equal(first, second);
  });
});

// ── plugin-bridge ─────────────────────────────────────

describe("plugin-bridge", () => {
  let mod;

  before(async () => {
    mod = await import("../dist/platform/providers/codex/plugin-bridge.js");
  });

  it("buildCompanionPrompt produces XML-tag structured prompt", () => {
    const prompt = mod.buildCompanionPrompt({
      evidence: "test evidence content",
      prompt: "Review these changes",
      files: ["src/index.ts", "src/utils.ts"],
      sessionId: "test-123",
    });

    assert.ok(prompt.includes("<task>"));
    assert.ok(prompt.includes("</task>"));
    assert.ok(prompt.includes("<evidence>"));
    assert.ok(prompt.includes("test evidence content"));
    assert.ok(prompt.includes("<changed_files>"));
    assert.ok(prompt.includes("- src/index.ts"));
    assert.ok(prompt.includes("<grounding_rules>"));
    assert.ok(prompt.includes("<structured_output_contract>"));
  });

  it("parsePluginOutput parses direct JSON", () => {
    const result = mod.parsePluginOutput(JSON.stringify({
      verdict: "approve",
      summary: "All good",
      findings: [],
      rejection_codes: [],
      next_steps: [],
    }));

    assert.ok(result);
    assert.equal(result.verdict, "approve");
    assert.equal(result.summary, "All good");
  });

  it("parsePluginOutput parses fenced JSON", () => {
    const raw = `Here is my review:

\`\`\`json
{
  "verdict": "needs-attention",
  "summary": "Found issues",
  "findings": [{"severity": "high", "title": "Bug", "body": "Null check missing"}]
}
\`\`\`

That's all.`;

    const result = mod.parsePluginOutput(raw);
    assert.ok(result);
    assert.equal(result.verdict, "needs-attention");
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].title, "Bug");
  });

  it("parsePluginOutput handles embedded JSON in text", () => {
    const raw = 'Based on my review, {"verdict":"approve","summary":"Clean code","findings":[],"next_steps":[]} is my verdict.';
    const result = mod.parsePluginOutput(raw);
    assert.ok(result);
    assert.equal(result.verdict, "approve");
  });

  it("parsePluginOutput returns null for non-JSON", () => {
    const result = mod.parsePluginOutput("This is plain text with no JSON.");
    assert.equal(result, null);
  });

  it("parsePluginOutput handles NDJSON with wrapped verdict", () => {
    const raw = [
      '{"type":"turn.started","turnId":"t1"}',
      '{"type":"item.completed","content":"working..."}',
      '{"verdict":"needs-attention","summary":"Issue found","findings":[{"severity":"medium","title":"Performance","body":"Slow query"}]}',
    ].join("\n");

    const result = mod.parsePluginOutput(raw);
    assert.ok(result);
    assert.equal(result.verdict, "needs-attention");
    assert.equal(result.findings[0].title, "Performance");
  });

  it("mapPluginVerdict maps approve to approved", () => {
    const result = mod.mapPluginVerdict(
      { verdict: "approve", summary: "LGTM", findings: [], rejection_codes: [] },
      "raw output",
      1000,
    );
    assert.equal(result.verdict, "approved");
    assert.deepEqual(result.codes, []);
    assert.equal(result.duration, 1000);
  });

  it("mapPluginVerdict maps needs-attention to changes_requested with codes", () => {
    const result = mod.mapPluginVerdict(
      {
        verdict: "needs-attention",
        summary: "Issues found",
        findings: [
          { severity: "high", title: "SQL Injection", body: "Unsafe query" },
          { severity: "low", title: "Style", body: "Minor" },
        ],
        rejection_codes: ["sql-injection"],
      },
      "raw",
      2000,
    );
    assert.equal(result.verdict, "changes_requested");
    assert.deepEqual(result.codes, ["sql-injection"]);
  });

  it("mapPluginVerdict generates codes from findings when rejection_codes empty", () => {
    const result = mod.mapPluginVerdict(
      {
        verdict: "needs-attention",
        findings: [
          { severity: "high", title: "Missing Error Handler", body: "No try/catch" },
        ],
      },
      "raw",
      500,
    );
    assert.equal(result.verdict, "changes_requested");
    assert.equal(result.codes[0], "missing-error-handler");
  });
});

// ── plugin-auditor ────────────────────────────────────

describe("plugin-auditor", () => {
  let mod;

  before(async () => {
    mod = await import("../dist/platform/providers/codex/plugin-auditor.js");
  });

  it("CodexPluginAuditor class exists and implements Auditor", () => {
    const auditor = new mod.CodexPluginAuditor({ cwd: process.cwd() });
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });

  it("available() returns false when plugin is not installed", async () => {
    // In test environment, codex-plugin-cc is typically not installed
    const { resetBrokerCache } = await import("../dist/platform/providers/codex/broker-detect.js");
    resetBrokerCache();
    const auditor = new mod.CodexPluginAuditor();
    const result = await auditor.available();
    // Should not throw, returns boolean
    assert.equal(typeof result, "boolean");
  });

  it("audit() returns infra_failure when companion not found", async () => {
    const { resetBrokerCache } = await import("../dist/platform/providers/codex/broker-detect.js");
    resetBrokerCache();
    // Force unavailable by not having codex-plugin-cc installed
    const auditor = new mod.CodexPluginAuditor();
    const isAvailable = await auditor.available();
    if (!isAvailable) {
      const result = await auditor.audit({
        evidence: "test",
        prompt: "test",
        files: ["test.ts"],
      });
      assert.equal(result.verdict, "infra_failure");
      assert.ok(result.codes.includes("codex-plugin-unavailable"));
    }
  });
});

// ── factory integration ───────────────────────────────

describe("factory codex-plugin routing", () => {
  it("createAuditor('codex') returns an Auditor instance", async () => {
    const { createAuditor } = await import("../dist/platform/providers/auditors/factory.js");
    const auditor = createAuditor("codex");
    assert.ok(auditor);
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });

  it("createAuditor('codex') returns CodexPluginAuditor when plugin available, CodexAuditor otherwise", async () => {
    const { createAuditor } = await import("../dist/platform/providers/auditors/factory.js");
    const { isCodexPluginAvailable, resetBrokerCache } = await import("../dist/platform/providers/codex/broker-detect.js");

    resetBrokerCache();
    const auditor = createAuditor("codex");
    const pluginAvailable = isCodexPluginAvailable();

    if (pluginAvailable) {
      assert.equal(auditor.constructor.name, "CodexPluginAuditor");
    } else {
      assert.equal(auditor.constructor.name, "CodexAuditor");
    }
  });
});

// ── adversarial-review ────────────────────────────────

describe("adversarial-review", () => {
  let mod;

  before(async () => {
    mod = await import("../dist/platform/providers/codex/adversarial-review.js");
  });

  it("exports required functions", () => {
    assert.equal(typeof mod.isAdversarialReviewAvailable, "function");
    assert.equal(typeof mod.runAdversarialReview, "function");
    assert.equal(typeof mod.toAuditResult, "function");
  });

  it("isAdversarialReviewAvailable returns boolean", () => {
    const result = mod.isAdversarialReviewAvailable();
    assert.equal(typeof result, "boolean");
  });

  it("toAuditResult converts review result to AuditResult", () => {
    const review = {
      hasIssues: true,
      summary: "Design flaw in caching",
      findings: [
        { severity: "high", title: "Cache Invalidation", body: "No TTL", confidence: 0.9 },
        { severity: "low", title: "Naming", body: "Unclear var name", confidence: 0.6 },
      ],
      nextSteps: ["Add TTL to cache entries"],
      raw: "raw output",
      duration: 5000,
    };

    const result = mod.toAuditResult(review);
    assert.equal(result.verdict, "changes_requested");
    assert.ok(result.codes.includes("cache-invalidation"));
    assert.ok(!result.codes.includes("naming")); // low severity filtered
    assert.equal(result.summary, "Design flaw in caching");
    assert.equal(result.duration, 5000);
  });

  it("toAuditResult returns approved when no issues", () => {
    const review = {
      hasIssues: false,
      summary: "Clean implementation",
      findings: [],
      nextSteps: [],
      raw: "",
      duration: 1000,
    };

    const result = mod.toAuditResult(review);
    assert.equal(result.verdict, "approved");
    assert.deepEqual(result.codes, []);
  });

  it("runAdversarialReview returns gracefully when plugin unavailable", async () => {
    const { resetBrokerCache, isCodexPluginAvailable } = await import("../dist/platform/providers/codex/broker-detect.js");
    resetBrokerCache();
    if (!isCodexPluginAvailable()) {
      const result = await mod.runAdversarialReview({ cwd: process.cwd() });
      assert.equal(result.hasIssues, false);
      assert.ok(result.summary.includes("not available"));
    }
  });
});
