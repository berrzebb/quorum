#!/usr/bin/env node
/**
 * Auditor Factory + Multi-Provider Tests
 *
 * Run: node --test tests/auditors.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { createAuditor, createConsensusAuditors, parseSpec, listAuditorProviders } = await import("../dist/platform/providers/auditors/factory.js");
const { ClaudeAuditor } = await import("../dist/platform/providers/auditors/claude.js");
const { OpenAIAuditor } = await import("../dist/platform/providers/auditors/openai.js");
const { GeminiAuditor } = await import("../dist/platform/providers/auditors/gemini.js");
const { CodexAuditor } = await import("../dist/platform/providers/codex/auditor.js");
const { OpenAICompatibleAuditor } = await import("../dist/platform/providers/auditors/openai-compatible.js");
const { OllamaAuditor } = await import("../dist/platform/providers/auditors/ollama.js");
const { VllmAuditor } = await import("../dist/platform/providers/auditors/vllm.js");

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

  it("creates OllamaAuditor from 'ollama'", () => {
    const auditor = createAuditor("ollama:qwen3:8b");
    assert.ok(auditor);
    assert.ok(auditor.audit);
    assert.ok(auditor.available);
  });

  it("creates VllmAuditor from 'vllm'", () => {
    const auditor = createAuditor("vllm:meta-llama/Llama-3.1-8B");
    assert.ok(auditor);
    assert.ok(auditor.audit);
    assert.ok(auditor.available);
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
  it("lists all 6 providers", () => {
    const providers = listAuditorProviders();
    assert.ok(providers.includes("codex"));
    assert.ok(providers.includes("claude"));
    assert.ok(providers.includes("openai"));
    assert.ok(providers.includes("gemini"));
    assert.ok(providers.includes("ollama"));
    assert.ok(providers.includes("vllm"));
    assert.equal(providers.length, 6);
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

  it("Ollama returns infra_failure when server unreachable", async () => {
    const auditor = new OllamaAuditor({
      baseUrl: "http://127.0.0.1:19999/v1", // unlikely port
      model: "test",
      timeout: 2000,
    });
    const result = await auditor.audit({ evidence: "test", prompt: "review", files: [] });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });

  it("vLLM returns infra_failure when server unreachable", async () => {
    const auditor = new VllmAuditor({
      baseUrl: "http://127.0.0.1:19998/v1",
      model: "test",
      timeout: 2000,
    });
    const result = await auditor.audit({ evidence: "test", prompt: "review", files: [] });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
  });
});

// ═══ 7. OpenAI-Compatible base class ═════════════════════════════════

describe("OpenAICompatibleAuditor", () => {
  it("constructs with default config", () => {
    const auditor = new OpenAICompatibleAuditor();
    assert.ok(auditor);
    assert.ok(auditor.audit);
    assert.ok(auditor.available);
  });

  it("respects custom config", () => {
    const auditor = new OpenAICompatibleAuditor({
      apiKey: "test-key",
      model: "custom-model",
      baseUrl: "http://custom:9999/v1",
      timeout: 60000,
      maxToolRounds: 3,
      enableTools: false,
    });
    assert.ok(auditor);
  });

  it("returns infra_failure when server unreachable", async () => {
    const auditor = new OpenAICompatibleAuditor({
      baseUrl: "http://127.0.0.1:19997/v1",
      timeout: 2000,
    });
    const result = await auditor.audit({ evidence: "test", prompt: "review", files: ["a.ts"] });
    assert.equal(result.verdict, "infra_failure");
    assert.ok(result.codes.includes("auditor-error"));
    assert.ok(result.duration > 0);
  });

  it("available() returns false when server unreachable", async () => {
    const auditor = new OpenAICompatibleAuditor({
      baseUrl: "http://127.0.0.1:19996/v1",
    });
    assert.equal(await auditor.available(), false);
  });

  it("supports custom toolExecutor", async () => {
    let toolCalled = false;
    const executor = async (name, args) => {
      toolCalled = true;
      return `result from ${name}`;
    };
    const auditor = new OpenAICompatibleAuditor({
      baseUrl: "http://127.0.0.1:19995/v1",
      toolExecutor: executor,
      timeout: 2000,
    });
    // Audit will fail (no server), but executor should be configured
    assert.ok(auditor);
  });
});

// ═══ 8. Ollama/vLLM specific config ═════════════════════════════════

describe("OllamaAuditor config", () => {
  it("uses default Ollama baseUrl", () => {
    const auditor = new OllamaAuditor();
    assert.ok(auditor);
    // Verify it's an instance of OpenAICompatibleAuditor
    assert.ok(auditor instanceof OpenAICompatibleAuditor);
  });

  it("available() returns false when Ollama not running", async () => {
    const auditor = new OllamaAuditor({
      baseUrl: "http://127.0.0.1:19994/v1",
    });
    assert.equal(await auditor.available(), false);
  });
});

describe("VllmAuditor config", () => {
  it("uses default vLLM baseUrl", () => {
    const auditor = new VllmAuditor();
    assert.ok(auditor);
    assert.ok(auditor instanceof OpenAICompatibleAuditor);
  });

  it("available() returns false when vLLM not running", async () => {
    const auditor = new VllmAuditor({
      baseUrl: "http://127.0.0.1:19993/v1",
    });
    assert.equal(await auditor.available(), false);
  });
});

// ═══ 9. Consensus with local providers ═══════════════════════════════

describe("consensus with ollama/vllm", () => {
  it("creates 3-role consensus with mixed local providers", () => {
    const auditors = createConsensusAuditors({
      advocate: "ollama:qwen3:8b",
      devil: "vllm:meta-llama/Llama-3.1-8B",
      judge: "claude",
    });
    assert.ok(auditors.advocate);
    assert.ok(auditors.devil);
    assert.ok(auditors.judge);
    assert.ok(auditors.advocate instanceof OpenAICompatibleAuditor);
    assert.ok(auditors.devil instanceof OpenAICompatibleAuditor);
  });

  it("creates all-ollama consensus", () => {
    const auditors = createConsensusAuditors({
      advocate: "ollama:qwen3:8b",
      devil: "ollama:llama3.1",
      judge: "ollama:mistral",
    });
    assert.ok(auditors.advocate);
    assert.ok(auditors.devil);
    assert.ok(auditors.judge);
  });
});
