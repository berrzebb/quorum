#!/usr/bin/env node
/**
 * Auditor Factory + Multi-Provider Tests
 *
 * Run: node --test tests/auditors.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { createAuditor, createConsensusAuditors, parseSpec, listAuditorProviders } = await import("../dist/providers/auditors/factory.js");
const { ClaudeAuditor } = await import("../dist/providers/auditors/claude.js");
const { OpenAIAuditor } = await import("../dist/providers/auditors/openai.js");
const { GeminiAuditor } = await import("../dist/providers/auditors/gemini.js");
const { CodexAuditor } = await import("../dist/providers/codex/auditor.js");

// ═══ 1. parseSpec ═════════════════════════════════════════════════════

describe("parseSpec", () => {
  it("parses provider only", () => {
    const spec = parseSpec("codex");
    assert.equal(spec.provider, "codex");
    assert.equal(spec.model, undefined);
  });

  it("parses provider:model", () => {
    const spec = parseSpec("openai:gpt-4o");
    assert.equal(spec.provider, "openai");
    assert.equal(spec.model, "gpt-4o");
  });

  it("parses provider with complex model name", () => {
    const spec = parseSpec("claude:claude-opus-4-6");
    assert.equal(spec.provider, "claude");
    assert.equal(spec.model, "claude-opus-4-6");
  });
});

// ═══ 2. createAuditor ═════════════════════════════════════════════════

describe("createAuditor", () => {
  it("creates CodexAuditor from 'codex'", () => {
    const auditor = createAuditor("codex");
    assert.ok(auditor);
    assert.ok(auditor.audit);
    assert.ok(auditor.available);
  });

  it("creates ClaudeAuditor from 'claude'", () => {
    const auditor = createAuditor("claude:claude-opus-4-6");
    assert.ok(auditor);
  });

  it("creates OpenAIAuditor from 'openai'", () => {
    const auditor = createAuditor("openai:gpt-4o");
    assert.ok(auditor);
  });

  it("creates OpenAIAuditor from 'gpt' alias", () => {
    const auditor = createAuditor("gpt:gpt-4o");
    assert.ok(auditor);
  });

  it("creates GeminiAuditor from 'gemini'", () => {
    const auditor = createAuditor("gemini:gemini-2.5-flash");
    assert.ok(auditor);
  });

  it("creates GeminiAuditor from 'google' alias", () => {
    const auditor = createAuditor("google");
    assert.ok(auditor);
  });

  it("throws for unknown provider", () => {
    assert.throws(() => createAuditor("unknown-provider"), /Unknown auditor provider/);
  });
});

// ═══ 3. createConsensusAuditors ═══════════════════════════════════════

describe("createConsensusAuditors", () => {
  it("creates 3 auditors from role config", () => {
    const auditors = createConsensusAuditors({
      advocate: "claude:claude-opus-4-6",
      devil: "openai:gpt-4o",
      judge: "codex",
    });

    assert.ok(auditors.advocate);
    assert.ok(auditors.devil);
    assert.ok(auditors.judge);
  });

  it("uses default provider for missing roles", () => {
    const auditors = createConsensusAuditors({
      default: "codex",
      advocate: "claude",
    });

    assert.ok(auditors.advocate); // claude
    assert.ok(auditors.devil);    // codex (default)
    assert.ok(auditors.judge);    // codex (default)
  });

  it("falls back to codex when no config", () => {
    const auditors = createConsensusAuditors({});
    assert.ok(auditors.advocate);
    assert.ok(auditors.devil);
    assert.ok(auditors.judge);
  });
});

// ═══ 4. Availability checks ═══════════════════════════════════════════

describe("auditor availability", () => {
  it("CodexAuditor.available() returns false when binary missing", async () => {
    const auditor = new CodexAuditor({ bin: "nonexistent-12345" });
    assert.equal(await auditor.available(), false);
  });

  it("ClaudeAuditor.available() returns false when binary missing", async () => {
    const auditor = new ClaudeAuditor({ bin: "nonexistent-12345" });
    assert.equal(await auditor.available(), false);
  });

  it("OpenAIAuditor.available() returns false without API key", async () => {
    const auditor = new OpenAIAuditor({ apiKey: "" });
    assert.equal(await auditor.available(), false);
  });

  it("GeminiAuditor.available() returns false with invalid binary", async () => {
    const auditor = new GeminiAuditor({ bin: "nonexistent-gemini-binary-xyz" });
    assert.equal(await auditor.available(), false);
  });
});

// ═══ 5. listAuditorProviders ══════════════════════════════════════════

describe("listAuditorProviders", () => {
  it("lists all 4 providers", () => {
    const providers = listAuditorProviders();
    assert.ok(providers.includes("codex"));
    assert.ok(providers.includes("claude"));
    assert.ok(providers.includes("openai"));
    assert.ok(providers.includes("gemini"));
    assert.equal(providers.length, 4);
  });
});

// ═══ 6. Error handling (no real API calls) ════════════════════════════

describe("auditor error handling", () => {
  it("OpenAI returns infra_failure without key", async () => {
    const auditor = new OpenAIAuditor({ apiKey: "" });
    const result = await auditor.audit({ evidence: "test", prompt: "review", files: [] });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });

  it("Gemini returns infra_failure with invalid binary", async () => {
    const auditor = new GeminiAuditor({ bin: "nonexistent-gemini-binary-xyz" });
    const result = await auditor.audit({ evidence: "test", prompt: "review", files: [] });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });
});
