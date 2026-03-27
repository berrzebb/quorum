/**
 * Ollama Auditor — local LLM auditing via Ollama's OpenAI-compatible API.
 *
 * Ollama exposes /v1/chat/completions with tool calling support.
 * No API key required for local deployments.
 *
 * Usage:
 *   quorum parliament --advocate ollama:qwen3:8b --devil ollama:llama3.1 --judge codex "topic"
 *
 * Environment:
 *   OLLAMA_BASE_URL   — API base (default: http://localhost:11434/v1)
 *   OLLAMA_MODEL      — Default model (default: qwen3:8b)
 *   OLLAMA_API_KEY    — Optional, for remote Ollama instances with auth
 */

import { OpenAICompatibleAuditor } from "./openai-compatible.js";
import type { OpenAICompatibleConfig } from "./openai-compatible.js";

export interface OllamaAuditorConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  maxToolRounds?: number;
  enableTools?: boolean;
}

export class OllamaAuditor extends OpenAICompatibleAuditor {
  constructor(config: OllamaAuditorConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OLLAMA_API_KEY ?? "",
      model: config.model ?? process.env.OLLAMA_MODEL ?? "qwen3:8b",
      baseUrl: config.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      timeout: config.timeout ?? 300_000, // 5min — local models can be slow
      maxToolRounds: config.maxToolRounds ?? 5,
      enableTools: config.enableTools,
    });
  }

  /**
   * Check Ollama availability by listing local models via /api/tags.
   * Falls back to /v1/models if /api/tags is unavailable.
   */
  async available(): Promise<boolean> {
    // Try Ollama-native endpoint first (more reliable)
    const ollamaApiBase = this.baseUrl.replace(/\/v1\/?$/, "");

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${ollamaApiBase}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      // Fallback to OpenAI-compatible endpoint
      return super.available();
    }
  }
}
