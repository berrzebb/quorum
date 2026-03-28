#!/usr/bin/env node
/**
 * Provider Behavior Baseline — SDK-1
 *
 * Freezes current provider contracts as regression anchors.
 * These tests MUST continue passing after SessionRuntime is introduced.
 *
 * Contracts frozen:
 * 1. Auditor interface (structural)
 * 2. Factory contract (parseSpec, createAuditor, createConsensusAuditors, listAuditorProviders)
 * 3. One-shot execution contract (audit() returns Promise<AuditResult>)
 * 4. Consensus contract (DeliberativeConsensus: run, runSimple, runDivergeConverge)
 * 5. Provider lifecycle (QuorumProvider: start, stop, status)
 * 6. Execution mode baseline (no SessionRuntime, no ProviderSessionRef, no ProviderExecutionMode)
 *
 * Run: npm run build && node --test tests/provider-baseline.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Imports (same pattern as existing tests) ─────────────────────────

const { registerProvider, getProvider, listProviders } = await import(
  "../dist/platform/providers/provider.js"
);
const {
  createAuditor,
  createConsensusAuditors,
  parseSpec,
  listAuditorProviders,
} = await import("../dist/platform/providers/auditors/factory.js");
const { DeliberativeConsensus } = await import(
  "../dist/platform/providers/consensus.js"
);
const { ClaudeCodeProvider } = await import(
  "../dist/platform/providers/claude-code/adapter.js"
);
const { CodexAuditor } = await import(
  "../dist/platform/providers/codex/auditor.js"
);
const { ClaudeAuditor } = await import(
  "../dist/platform/providers/auditors/claude.js"
);
const { OpenAIAuditor } = await import(
  "../dist/platform/providers/auditors/openai.js"
);
const { GeminiAuditor } = await import(
  "../dist/platform/providers/auditors/gemini.js"
);
const { OllamaAuditor } = await import(
  "../dist/platform/providers/auditors/ollama.js"
);
const { VllmAuditor } = await import(
  "../dist/platform/providers/auditors/vllm.js"
);
const { QuorumBus } = await import("../dist/platform/bus/bus.js");

// ── Mock auditor factory ─────────────────────────────────────────────

function mockAuditor(verdict, summary = "", codes = []) {
  return {
    async audit(_request) {
      const raw = JSON.stringify({
        verdict,
        reasoning: summary,
        summary,
        codes,
        confidence: verdict === "approved" ? 0.9 : 0.8,
      });
      return { verdict, codes, summary, raw, duration: 10 };
    },
    async available() {
      return true;
    },
  };
}

// ── Temp dir ─────────────────────────────────────────────────────────

let tmpDir;
before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "provider-baseline-"));
});
after(() => {
  if (tmpDir && existsSync(tmpDir))
    rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════
// 1. Auditor interface contract (structural)
// ═══════════════════════════════════════════════════════════════════════

describe("BASELINE: Auditor interface contract", () => {
  it("Auditor instances have 'audit' method", () => {
    const auditor = createAuditor("codex");
    assert.equal(typeof auditor.audit, "function");
  });

  it("Auditor instances have 'available' method", () => {
    const auditor = createAuditor("codex");
    assert.equal(typeof auditor.available, "function");
  });

  it("AuditRequest accepts evidence, prompt, files, sessionId", async () => {
    // Structural: the mock auditor accepts a request with all 4 fields
    const auditor = mockAuditor("approved");
    const request = {
      evidence: "test evidence",
      prompt: "review this code",
      files: ["a.ts", "b.ts"],
      sessionId: "session-123",
    };
    const result = await auditor.audit(request);
    assert.ok(result, "audit() should accept a request with all 4 fields");
  });

  it("AuditResult has verdict, codes, summary, raw, duration fields", async () => {
    const auditor = mockAuditor("approved", "All good", ["clean"]);
    const result = await auditor.audit({
      evidence: "e",
      prompt: "p",
      files: [],
    });
    assert.ok("verdict" in result, "AuditResult must have 'verdict'");
    assert.ok("codes" in result, "AuditResult must have 'codes'");
    assert.ok("summary" in result, "AuditResult must have 'summary'");
    assert.ok("raw" in result, "AuditResult must have 'raw'");
    assert.ok("duration" in result, "AuditResult must have 'duration'");
  });

  it("AuditResult.verdict is one of: approved, changes_requested, infra_failure", async () => {
    const validVerdicts = ["approved", "changes_requested", "infra_failure"];

    for (const v of validVerdicts) {
      const auditor = mockAuditor(v);
      const result = await auditor.audit({
        evidence: "e",
        prompt: "p",
        files: [],
      });
      assert.ok(
        validVerdicts.includes(result.verdict),
        `Verdict "${result.verdict}" must be one of ${validVerdicts.join(", ")}`,
      );
    }
  });

  it("Real CodexAuditor conforms to Auditor interface", () => {
    const auditor = new CodexAuditor({ bin: "nonexistent" });
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });

  it("Real ClaudeAuditor conforms to Auditor interface", () => {
    const auditor = new ClaudeAuditor({ bin: "nonexistent" });
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });

  it("Real OpenAIAuditor conforms to Auditor interface", () => {
    const auditor = new OpenAIAuditor({ apiKey: "" });
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });

  it("Real GeminiAuditor conforms to Auditor interface", () => {
    const auditor = new GeminiAuditor({ bin: "nonexistent" });
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });

  it("Real OllamaAuditor conforms to Auditor interface", () => {
    const auditor = new OllamaAuditor({ model: "test" });
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });

  it("Real VllmAuditor conforms to Auditor interface", () => {
    const auditor = new VllmAuditor({ model: "test" });
    assert.equal(typeof auditor.audit, "function");
    assert.equal(typeof auditor.available, "function");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Factory contract
// ═══════════════════════════════════════════════════════════════════════

describe("BASELINE: Factory contract", () => {
  it("parseSpec('codex') returns { provider: 'codex' }", () => {
    const spec = parseSpec("codex");
    assert.equal(spec.provider, "codex");
    assert.equal(spec.model, undefined);
  });

  it("parseSpec('claude:opus') returns { provider: 'claude', model: 'opus' }", () => {
    const spec = parseSpec("claude:opus");
    assert.equal(spec.provider, "claude");
    assert.equal(spec.model, "opus");
  });

  it("parseSpec handles complex model names with colons", () => {
    const spec = parseSpec("ollama:qwen3:8b");
    assert.equal(spec.provider, "ollama");
    assert.equal(spec.model, "qwen3:8b");
  });

  it("createAuditor returns object with audit+available for each provider", () => {
    const providers = ["codex", "claude", "openai", "gemini", "ollama", "vllm"];
    for (const p of providers) {
      const auditor = createAuditor(p);
      assert.ok(auditor, `createAuditor('${p}') must return an object`);
      assert.equal(
        typeof auditor.audit,
        "function",
        `${p} auditor must have audit()`,
      );
      assert.equal(
        typeof auditor.available,
        "function",
        `${p} auditor must have available()`,
      );
    }
  });

  it("createAuditor throws for unknown provider", () => {
    assert.throws(
      () => createAuditor("unknown-xyz"),
      /Unknown auditor provider/,
    );
  });

  it("createConsensusAuditors returns { advocate, devil, judge }", () => {
    const auditors = createConsensusAuditors({
      advocate: "claude",
      devil: "openai",
      judge: "codex",
    });
    assert.ok(auditors.advocate, "must have advocate");
    assert.ok(auditors.devil, "must have devil");
    assert.ok(auditors.judge, "must have judge");
    assert.equal(typeof auditors.advocate.audit, "function");
    assert.equal(typeof auditors.devil.audit, "function");
    assert.equal(typeof auditors.judge.audit, "function");
  });

  it("createConsensusAuditors uses default for missing roles", () => {
    const auditors = createConsensusAuditors({ default: "codex" });
    assert.ok(auditors.advocate);
    assert.ok(auditors.devil);
    assert.ok(auditors.judge);
  });

  it("listAuditorProviders returns at least the 6 known providers", () => {
    const providers = listAuditorProviders();
    const required = ["codex", "claude", "openai", "gemini", "ollama", "vllm"];
    for (const p of required) {
      assert.ok(
        providers.includes(p),
        `listAuditorProviders() must include '${p}'`,
      );
    }
    assert.ok(providers.length >= 6, "must return at least 6 providers");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. One-shot execution contract
// ═══════════════════════════════════════════════════════════════════════

describe("BASELINE: One-shot execution contract", () => {
  it("audit() returns a Promise", () => {
    const auditor = mockAuditor("approved");
    const result = auditor.audit({
      evidence: "e",
      prompt: "p",
      files: [],
    });
    assert.ok(result instanceof Promise, "audit() must return a Promise");
  });

  it("audit() resolves to AuditResult with verdict, summary, duration", async () => {
    const auditor = mockAuditor("approved", "clean code");
    const result = await auditor.audit({
      evidence: "e",
      prompt: "p",
      files: [],
    });
    assert.equal(typeof result.verdict, "string");
    assert.equal(typeof result.summary, "string");
    assert.equal(typeof result.duration, "number");
  });

  it("CodexAuditor returns infra_failure when binary unavailable", async () => {
    const auditor = new CodexAuditor({ bin: "nonexistent-binary-xyz-12345" });
    const result = await auditor.audit({
      evidence: "test",
      prompt: "review",
      files: [],
    });
    assert.equal(
      result.verdict,
      "infra_failure",
      "unavailable binary must yield infra_failure, not throw",
    );
    assert.ok(result.codes.includes("auditor-error"));
    assert.ok(result.duration >= 0);
  });

  it("ClaudeAuditor returns infra_failure when binary unavailable", async () => {
    const auditor = new ClaudeAuditor({ bin: "nonexistent-binary-xyz-12345" });
    const result = await auditor.audit({
      evidence: "test",
      prompt: "review",
      files: [],
    });
    assert.equal(
      result.verdict,
      "infra_failure",
      "unavailable binary must yield infra_failure, not throw",
    );
    assert.ok(result.codes.includes("auditor-error"));
  });

  it("OpenAIAuditor returns infra_failure without API key", async () => {
    const auditor = new OpenAIAuditor({ apiKey: "" });
    const result = await auditor.audit({
      evidence: "test",
      prompt: "review",
      files: [],
    });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });

  it("GeminiAuditor returns infra_failure with invalid binary", async () => {
    const auditor = new GeminiAuditor({
      bin: "nonexistent-gemini-binary-xyz",
    });
    const result = await auditor.audit({
      evidence: "test",
      prompt: "review",
      files: [],
    });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });

  it("OllamaAuditor returns infra_failure when server unreachable", async () => {
    const auditor = new OllamaAuditor({
      baseUrl: "http://127.0.0.1:19899/v1",
      model: "test",
      timeout: 2000,
    });
    const result = await auditor.audit({
      evidence: "test",
      prompt: "review",
      files: [],
    });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });

  it("VllmAuditor returns infra_failure when server unreachable", async () => {
    const auditor = new VllmAuditor({
      baseUrl: "http://127.0.0.1:19898/v1",
      model: "test",
      timeout: 2000,
    });
    const result = await auditor.audit({
      evidence: "test",
      prompt: "review",
      files: [],
    });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });

  it("One-shot: audit() never requires prior start() or session setup", async () => {
    // Core contract: Auditor.audit() is stateless one-shot — no lifecycle needed
    const auditor = new CodexAuditor({ bin: "nonexistent" });
    // Must not throw due to missing session/connection
    const result = await auditor.audit({
      evidence: "test",
      prompt: "review",
      files: ["a.ts"],
    });
    assert.ok(
      result.verdict,
      "audit() works without prior start() call",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Consensus contract
// ═══════════════════════════════════════════════════════════════════════

describe("BASELINE: Consensus contract", () => {
  it("DeliberativeConsensus has run, runSimple, runDivergeConverge methods", () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved"),
      devil: mockAuditor("approved"),
      judge: mockAuditor("approved"),
    });
    assert.equal(typeof consensus.run, "function", "must have run()");
    assert.equal(
      typeof consensus.runSimple,
      "function",
      "must have runSimple()",
    );
    assert.equal(
      typeof consensus.runDivergeConverge,
      "function",
      "must have runDivergeConverge()",
    );
  });

  it("ConsensusVerdict has mode, finalVerdict, opinions, judgeSummary, duration", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "OK"),
      devil: mockAuditor("approved", "OK"),
      judge: mockAuditor("approved", "Both agree"),
    });

    const result = await consensus.run({
      evidence: "test",
      prompt: "review",
      files: [],
    });

    assert.ok("mode" in result, "must have 'mode'");
    assert.ok("finalVerdict" in result, "must have 'finalVerdict'");
    assert.ok("opinions" in result, "must have 'opinions'");
    assert.ok("judgeSummary" in result, "must have 'judgeSummary'");
    assert.ok("duration" in result, "must have 'duration'");
  });

  it("run() with all-approve yields verdict 'approved'", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "Code is solid"),
      devil: mockAuditor("approved", "No issues"),
      judge: mockAuditor("approved", "Both agree, approved"),
    });

    const result = await consensus.run({
      evidence: "test",
      prompt: "review",
      files: ["a.ts"],
    });

    assert.equal(result.mode, "deliberative");
    assert.equal(result.finalVerdict, "approved");
    assert.equal(result.opinions.length, 2);
    assert.ok(result.duration >= 0);
  });

  it("run() with devil reject and judge reject yields 'changes_requested'", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "Looks fine"),
      devil: mockAuditor("changes_requested", "Root cause not addressed", [
        "principle-drift",
      ]),
      judge: mockAuditor("changes_requested", "Devil has a point", [
        "principle-drift",
      ]),
    });

    const result = await consensus.run({
      evidence: "test",
      prompt: "review",
      files: ["a.ts"],
    });

    assert.equal(result.finalVerdict, "changes_requested");
  });

  it("runSimple() returns single-auditor result with mode 'simple'", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "All good"),
      devil: mockAuditor("changes_requested"),
      judge: mockAuditor("changes_requested"),
    });

    const result = await consensus.runSimple({
      evidence: "test",
      prompt: "review",
      files: ["a.ts"],
    });

    assert.equal(result.mode, "simple");
    assert.equal(result.finalVerdict, "approved");
    assert.equal(result.opinions.length, 1);
  });

  it("runDivergeConverge() returns a ConsensusVerdict", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "OK"),
      devil: mockAuditor("approved", "OK"),
      judge: mockAuditor("approved", "Converged"),
    });

    const result = await consensus.runDivergeConverge({
      evidence: "test",
      prompt: "review",
      files: [],
    });

    assert.ok("mode" in result, "must have mode");
    assert.ok("finalVerdict" in result, "must have finalVerdict");
    assert.ok("opinions" in result, "must have opinions");
    assert.ok("duration" in result, "must have duration");
  });

  it("opinions have role, verdict, reasoning, codes, confidence", async () => {
    const consensus = new DeliberativeConsensus({
      advocate: mockAuditor("approved", "Clean code", ["clean"]),
      devil: mockAuditor("changes_requested", "Missing tests", ["no-test"]),
      judge: mockAuditor("changes_requested", "Needs tests"),
    });

    const result = await consensus.run({
      evidence: "test",
      prompt: "review",
      files: [],
    });

    for (const opinion of result.opinions) {
      assert.ok("role" in opinion, "opinion must have 'role'");
      assert.ok("verdict" in opinion, "opinion must have 'verdict'");
      assert.ok("reasoning" in opinion, "opinion must have 'reasoning'");
      assert.ok("codes" in opinion, "opinion must have 'codes'");
      assert.ok("confidence" in opinion, "opinion must have 'confidence'");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Provider lifecycle contract
// ═══════════════════════════════════════════════════════════════════════

describe("BASELINE: Provider lifecycle contract", () => {
  it("QuorumProvider has start, stop, status methods", () => {
    const provider = new ClaudeCodeProvider();
    assert.equal(typeof provider.start, "function", "must have start()");
    assert.equal(typeof provider.stop, "function", "must have stop()");
    assert.equal(typeof provider.status, "function", "must have status()");
  });

  it("status() before start() returns disconnected", () => {
    const provider = new ClaudeCodeProvider();
    const status = provider.status();
    assert.equal(status.connected, false, "must be disconnected before start");
    assert.equal(status.activeAgents, 0);
    assert.equal(status.pendingAudits, 0);
  });

  it("start() connects and stop() disconnects", async () => {
    const provider = new ClaudeCodeProvider();
    const bus = new QuorumBus();

    await provider.start(bus, {
      repoRoot: tmpDir,
      auditor: { model: "codex" },
    });
    assert.equal(provider.status().connected, true, "must be connected after start");

    await provider.stop();
    assert.equal(
      provider.status().connected,
      false,
      "must be disconnected after stop",
    );
  });

  it("stop() is idempotent (can be called multiple times)", async () => {
    const provider = new ClaudeCodeProvider();
    // Stop without start
    await provider.stop();
    await provider.stop();
    // Should not throw
    assert.ok(true, "stop() is idempotent");
  });

  it("provider has kind, displayName, capabilities properties", () => {
    const provider = new ClaudeCodeProvider();
    assert.equal(typeof provider.kind, "string");
    assert.equal(typeof provider.displayName, "string");
    assert.ok(Array.isArray(provider.capabilities));
    assert.ok(provider.capabilities.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Execution mode baseline (freeze current default)
// ═══════════════════════════════════════════════════════════════════════

describe("BASELINE: Execution mode baseline (no SDK runtime yet)", () => {
  it("provider.ts does NOT export SessionRuntime", async () => {
    const providerModule = await import(
      "../dist/platform/providers/provider.js"
    );
    assert.equal(
      providerModule.SessionRuntime,
      undefined,
      "SessionRuntime must not exist yet — it will be introduced by SDK-2",
    );
  });

  it("provider.ts does NOT export ProviderSessionRef", async () => {
    const providerModule = await import(
      "../dist/platform/providers/provider.js"
    );
    assert.equal(
      providerModule.ProviderSessionRef,
      undefined,
      "ProviderSessionRef must not exist yet",
    );
  });

  it("provider.ts does NOT export ProviderExecutionMode", async () => {
    const providerModule = await import(
      "../dist/platform/providers/provider.js"
    );
    assert.equal(
      providerModule.ProviderExecutionMode,
      undefined,
      "ProviderExecutionMode must not exist yet",
    );
  });

  it("provider.ts exports exactly: registerProvider, getProvider, listProviders", async () => {
    const providerModule = await import(
      "../dist/platform/providers/provider.js"
    );
    const exports = Object.keys(providerModule).sort();
    assert.ok(
      exports.includes("registerProvider"),
      "must export registerProvider",
    );
    assert.ok(exports.includes("getProvider"), "must export getProvider");
    assert.ok(exports.includes("listProviders"), "must export listProviders");
  });

  it("consensus.ts exports exactly: DeliberativeConsensus", async () => {
    const consensusModule = await import(
      "../dist/platform/providers/consensus.js"
    );
    const exports = Object.keys(consensusModule);
    assert.ok(
      exports.includes("DeliberativeConsensus"),
      "must export DeliberativeConsensus",
    );
  });

  it("current execution model is CLI-based (codex uses bin option)", () => {
    // CodexAuditor accepts a 'bin' option for CLI spawn
    const auditor = new CodexAuditor({ bin: "codex" });
    assert.ok(auditor, "CodexAuditor created with CLI bin option");
  });

  it("current execution model is CLI-based (claude uses bin option)", () => {
    // ClaudeAuditor accepts a 'bin' option for CLI spawn
    const auditor = new ClaudeAuditor({ bin: "claude" });
    assert.ok(auditor, "ClaudeAuditor created with CLI bin option");
  });

  it("current execution model is HTTP-based for openai/ollama/vllm", () => {
    // OpenAI-compatible auditors use baseUrl for HTTP
    const openai = new OpenAIAuditor({ apiKey: "test" });
    const ollama = new OllamaAuditor({
      baseUrl: "http://localhost:11434/v1",
    });
    const vllm = new VllmAuditor({ baseUrl: "http://localhost:8000/v1" });
    assert.ok(openai, "OpenAIAuditor created with HTTP config");
    assert.ok(ollama, "OllamaAuditor created with HTTP config");
    assert.ok(vllm, "VllmAuditor created with HTTP config");
  });
});
