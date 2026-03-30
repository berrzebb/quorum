/**
 * vLLM Auditor — local/remote LLM auditing via vLLM's OpenAI-compatible API.
 *
 * vLLM natively exposes /v1/chat/completions with full tool calling support.
 * API key optional for local deployments.
 *
 * Usage:
 *   quorum parliament --advocate vllm:Qwen/Qwen3-8B --devil vllm:meta-llama/Llama-3.1-8B --judge codex "topic"
 *
 * Environment:
 *   VLLM_BASE_URL   — API base (default: http://localhost:8000/v1)
 *   VLLM_MODEL      — Default model
 *   VLLM_API_KEY    — Optional, for authenticated endpoints
 */

import { OpenAICompatibleAuditor } from "./openai-compatible.js";
import type { OpenAICompatibleConfig } from "./openai-compatible.js";

export interface VllmAuditorConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
  maxToolRounds?: number;
  enableTools?: boolean;
}

export class VllmAuditor extends OpenAICompatibleAuditor {
  constructor(config: VllmAuditorConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.VLLM_API_KEY ?? "",
      model: config.model ?? process.env.VLLM_MODEL ?? "default",
      baseUrl: config.baseUrl ?? process.env.VLLM_BASE_URL ?? "http://localhost:8000/v1",
      timeout: config.timeout ?? 300_000,
      maxToolRounds: config.maxToolRounds ?? 5,
      enableTools: config.enableTools,
    });
  }

  /**
   * Check vLLM availability via /v1/models endpoint.
   * Also verifies the configured model is actually loaded.
   */
  async available(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const headers: Record<string, string> = {};
      if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl}/models`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) return false;

      // If model is "default", any available model works
      if (this.model === "default") return true;

      // Check if the specific model is loaded
      const data = await res.json() as { data?: Array<{ id: string }> };
      if (!data.data?.length) return true; // Can't verify, assume ok
      return data.data.some(m => m.id === this.model || m.id.includes(this.model));
    } catch (err) {
      console.warn(`[vllm-auditor] availability check failed: ${(err as Error).message}`);
      return false;
    }
  }
}
