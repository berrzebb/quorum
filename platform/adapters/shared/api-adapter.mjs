/**
 * OpenAI-Compatible API Adapter — HTTP-based alternative to CLI adapters.
 *
 * Provides the same AgentOutputMessage interface as cli-adapter.mjs but
 * communicates via HTTP chat completions API instead of spawning CLI processes.
 *
 * This enables any OpenAI-compatible endpoint (Ollama, vLLM, OpenAI, etc.)
 * to use quorum's full adapter infrastructure: skills, agents, tools, consensus.
 *
 * Wire protocol:
 *   POST /v1/chat/completions → { choices, usage }
 *   SSE stream: data: {"choices":[{"delta":{"content":"..."}}]} ... data: [DONE]
 *
 * Output: same AgentOutputMessage as CliAdapter (assistant_chunk, tool_use,
 *         tool_result, complete, error).
 *
 * @module adapters/shared/api-adapter
 */

/**
 * @typedef {import("./ndjson-parser.mjs").AgentOutputMessage} AgentOutputMessage
 *
 * @typedef {{
 *   provider: string,
 *   model: string,
 *   baseUrl: string,
 *   apiKey?: string,
 *   timeout?: number,
 *   maxToolRounds?: number,
 *   tools?: Array<{ type: "function", function: { name: string, description: string, parameters: object } }>,
 *   toolExecutor?: (name: string, args: object) => Promise<string>,
 * }} ApiAdapterConfig
 */

// ── Error classification (canonical source) ──

export function classifyErrorCode(msg) {
  if (/context.*overflow|prompt.*too.*large/i.test(msg)) return "token_limit";
  if (/invalid.*api.*key|unauthorized|authentication/i.test(msg)) return "auth";
  if (/rate.*limit|too.*many.*requests/i.test(msg)) return "rate_limit";
  if (/billing|quota.*exceeded|insufficient/i.test(msg)) return "billing";
  if (/failover|model.*unavailable|overloaded/i.test(msg)) return "failover";
  if (/crash|segfault|aborted/i.test(msg)) return "crash";
  return "fatal";
}

// ── OpenAI-Compatible API Adapter ──

export class OpenAIApiAdapter {
  /** @type {string} */
  cli_id;
  /** @type {"api"} */
  stdinMode = "api";
  /** @type {string|null} */
  sessionId = null;

  /** @type {ApiAdapterConfig} */
  #config;
  /** @type {Array<{role: string, content: string|null, tool_calls?: any[], tool_call_id?: string}>} */
  #messages = [];
  /** @type {string} */
  #lastAssistantText = "";
  /** @type {boolean} */
  #complete = false;
  /** @type {{input: number, output: number}} */
  #usage = { input: 0, output: 0 };

  /**
   * @param {ApiAdapterConfig} config
   */
  constructor(config) {
    this.#config = {
      timeout: 300_000,
      maxToolRounds: 5,
      ...config,
    };
    this.cli_id = config.provider || "openai-api";
    this.sessionId = `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── CliAdapter-compatible interface ──

  /**
   * Build argument descriptor (for compatibility with MuxAdapter).
   * API adapters don't spawn CLI processes, so this returns metadata instead.
   */
  buildArgs(options = {}) {
    return {
      _api: true,
      provider: this.#config.provider,
      model: options.model || this.#config.model,
      baseUrl: this.#config.baseUrl,
    };
  }

  /**
   * Parse output line (SSE chunk from streaming mode).
   * @param {string} line
   * @returns {AgentOutputMessage|AgentOutputMessage[]|null}
   */
  parse_output(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "data: [DONE]") return null;

    const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch (err) { console.warn(`[api-adapter] SSE JSON parse error: ${err?.message}`); return null; }

    const choice = parsed.choices?.[0];
    if (!choice) return null;

    // Streaming delta
    const delta = choice.delta;
    if (delta) {
      if (delta.content) {
        return { type: "assistant_chunk", content: delta.content, delta: true };
      }
      if (delta.tool_calls) {
        // Tool call chunks are accumulated externally
        return null;
      }
    }

    return null;
  }

  /** @param {{ content: string }} msg */
  formatInput(msg) { return msg.content; }

  // ── API-specific methods ──

  /**
   * Initialize conversation with system prompt.
   * @param {string} systemPrompt
   */
  setSystemPrompt(systemPrompt) {
    this.#messages = [{ role: "system", content: systemPrompt }];
    this.#complete = false;
    this.#lastAssistantText = "";
  }

  /**
   * Send a user message and run the full tool-calling loop.
   * Returns collected AgentOutputMessages.
   *
   * @param {string} content — user prompt
   * @returns {Promise<AgentOutputMessage[]>}
   */
  async send(content) {
    this.#messages.push({ role: "user", content });
    this.#complete = false;
    this.#lastAssistantText = "";

    const allMessages = [];
    let round = 0;

    while (round < this.#config.maxToolRounds) {
      let response;
      try {
        response = await this.#callApi();
      } catch (err) {
        const errMsg = { type: "error", code: classifyErrorCode(err.message), message: err.message };
        allMessages.push(errMsg);
        return allMessages;
      }

      const choice = response.choices?.[0];
      if (!choice) {
        allMessages.push({ type: "error", code: "fatal", message: "Empty response from API" });
        return allMessages;
      }

      // Accumulate usage
      if (response.usage) {
        this.#usage.input += response.usage.prompt_tokens || 0;
        this.#usage.output += response.usage.completion_tokens || 0;
      }

      const msg = choice.message;

      // Emit assistant text
      if (msg.content) {
        this.#lastAssistantText = msg.content;
        allMessages.push({ type: "assistant_chunk", content: msg.content, delta: true });
      }

      // No tool calls → done
      if (!msg.tool_calls?.length || choice.finish_reason === "stop") {
        this.#complete = true;
        allMessages.push({
          type: "complete",
          result: this.#lastAssistantText,
          usage: { ...this.#usage },
        });
        return allMessages;
      }

      // Process tool calls
      this.#messages.push({
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls,
      });

      for (const toolCall of msg.tool_calls) {
        const fnName = toolCall.function?.name || "unknown";
        let fnArgs = {};
        try { fnArgs = JSON.parse(toolCall.function?.arguments || "{}"); } catch (err) { console.warn(`[api-adapter] tool args parse error: ${err?.message}`); }

        allMessages.push({ type: "tool_use", tool: fnName, input: fnArgs });

        // Execute tool
        let result = `Tool "${fnName}" not available`;
        if (this.#config.toolExecutor) {
          try {
            result = await this.#config.toolExecutor(fnName, fnArgs);
          } catch (err) {
            result = `Tool error: ${err.message}`;
          }
        }

        allMessages.push({ type: "tool_result", tool: fnName, output: result });

        this.#messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      round++;
    }

    // Max rounds exceeded
    this.#complete = true;
    allMessages.push({
      type: "complete",
      result: this.#lastAssistantText || "(max tool rounds exceeded)",
      usage: { ...this.#usage },
    });
    return allMessages;
  }

  /**
   * Check if the session has completed.
   * @returns {boolean}
   */
  get complete() { return this.#complete; }

  /**
   * Get accumulated usage.
   * @returns {{ input: number, output: number }}
   */
  get usage() { return { ...this.#usage }; }

  /**
   * Check API availability.
   * @returns {Promise<boolean>}
   */
  async available() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const headers = {};
      if (this.#config.apiKey) headers["Authorization"] = `Bearer ${this.#config.apiKey}`;
      const res = await fetch(`${this.#config.baseUrl}/models`, { headers, signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch (err) {
      console.warn(`[api-adapter] availability check failed: ${err?.message}`);
      return false;
    }
  }

  /** Reset conversation state. */
  reset() {
    const systemMsg = this.#messages.find(m => m.role === "system");
    this.#messages = systemMsg ? [systemMsg] : [];
    this.#complete = false;
    this.#lastAssistantText = "";
    this.#usage = { input: 0, output: 0 };
  }

  // ── Private ──

  /**
   * @returns {Promise<{choices: Array<{message: {content: string|null, tool_calls?: any[]}, finish_reason: string}>, usage?: {prompt_tokens: number, completion_tokens: number}}>}
   */
  async #callApi() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeout);

    const body = {
      model: this.#config.model,
      messages: this.#messages,
      temperature: 0.2,
    };

    if (this.#config.tools?.length) {
      body.tools = this.#config.tools;
    }

    const headers = { "Content-Type": "application/json" };
    if (this.#config.apiKey) {
      headers["Authorization"] = `Bearer ${this.#config.apiKey}`;
    }

    try {
      const res = await fetch(`${this.#config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API ${res.status}: ${errText.slice(0, 300)}`);
      }

      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Factory ──

/**
 * Create an API adapter by provider configuration.
 *
 * @param {ApiAdapterConfig} config
 * @returns {OpenAIApiAdapter}
 */
export function createApiAdapter(config) {
  return new OpenAIApiAdapter(config);
}

// ── Provider presets ──

/** @type {Record<string, Partial<ApiAdapterConfig>>} */
export const API_PRESETS = {
  ollama: {
    provider: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
  },
  vllm: {
    provider: "vllm",
    baseUrl: "http://localhost:8000/v1",
    model: "default",
  },
  openai: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  anthropic: {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
  },
};

/**
 * Create an API adapter from a provider spec string.
 *
 * @param {string} spec — e.g. "ollama:qwen3:8b", "vllm:llama3.1", "openai:gpt-4o"
 * @param {Partial<ApiAdapterConfig>} [overrides]
 * @returns {OpenAIApiAdapter}
 */
export function createApiAdapterFromSpec(spec, overrides = {}) {
  const [provider, ...rest] = spec.split(":");
  const model = rest.length > 0 ? rest.join(":") : undefined;
  const preset = API_PRESETS[provider] || { provider, baseUrl: "http://localhost:8000/v1" };

  return new OpenAIApiAdapter({
    ...preset,
    ...(model ? { model } : {}),
    apiKey: process.env[`${provider.toUpperCase()}_API_KEY`] || "",
    ...overrides,
  });
}
