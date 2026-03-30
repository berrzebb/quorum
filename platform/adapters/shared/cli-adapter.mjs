/**
 * Multi-CLI NDJSON adapters — Claude Code, Codex CLI, Gemini CLI.
 *
 * Ported from SoulFlow-Orchestrator src/agent/pty/cli-adapter.ts.
 * Each adapter converts CLI-specific NDJSON output to a unified AgentOutputMessage format,
 * and builds CLI-specific argument lists for headless execution.
 *
 * Wire formats:
 *   Claude: {"type":"assistant","message":{"content":[...]}} + {"type":"result",...}
 *   Codex:  {"type":"item.completed","item":{"type":"agent_message",...}} + {"type":"turn.completed",...}
 *   Gemini: {"type":"message","role":"assistant",...} + {"type":"result",...}
 *
 * @module adapters/shared/cli-adapter
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import { classifyErrorCode } from "./api-adapter.mjs";

function mapErrorCode(parsed) {
  return classifyErrorCode(String(parsed.error ?? parsed.message ?? ""));
}

// ─── Claude Code ────────────────────────────────────────────────

/**
 * Claude Code CLI adapter (-p --output-format stream-json).
 *
 * stdin_mode: "close" — -p mode reads stdin until EOF.
 * Output: system init → assistant blocks → result.
 */
export class ClaudeCliAdapter {
  cli_id = "claude";
  stdinMode = "close";
  sessionId = null;

  buildArgs(options = {}) {
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (options.sessionKey && UUID_RE.test(options.sessionKey)) args.push("--session-id", options.sessionKey);
    if (options.systemPrompt) args.push("--append-system-prompt", options.systemPrompt);
    if (options.model) args.push("--model", options.model);
    if (options.maxTurns != null) args.push("--max-turns", String(options.maxTurns));
    if (options.allowedTools?.length) args.push("--allowedTools", ...options.allowedTools);
    if (options.disallowedTools?.length) args.push("--disallowedTools", ...options.disallowedTools);
    if (options.ephemeral) args.push("--no-session-persistence");
    if (options.maxBudgetUsd != null) args.push("--max-budget-usd", String(options.maxBudgetUsd));
    if (options.mcpConfig) args.push("--mcp-config", options.mcpConfig);
    return args;
  }

  parse_output(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return null;

    let parsed;
    try { parsed = JSON.parse(trimmed); } catch (err) { console.warn(`[cli-adapter] claude JSON parse error: ${err?.message}`); return null; }
    const type = String(parsed.type ?? "");

    if (type === "system" && parsed.subtype === "init") {
      this.sessionId = String(parsed.session_id ?? "");
      return null;
    }

    if (type === "assistant") {
      const blocks = parsed.message?.content;
      if (!Array.isArray(blocks) || blocks.length === 0) return null;
      const msgs = [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          msgs.push({ type: "assistant_chunk", content: String(block.text), delta: true });
        } else if (block.type === "tool_use") {
          msgs.push({ type: "tool_use", tool: String(block.name ?? "unknown"), input: block.input ?? {} });
        } else if (block.type === "tool_result") {
          msgs.push({ type: "tool_result", tool: String(block.tool_use_id ?? "unknown"), output: extractToolResultText(block) });
        }
      }
      if (msgs.length === 0) return null;
      return msgs.length === 1 ? msgs[0] : msgs;
    }

    if (type === "result") {
      const usage = parsed.usage;
      return {
        type: "complete",
        result: String(parsed.result ?? ""),
        usage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined,
      };
    }

    if (type === "error") {
      return { type: "error", code: mapErrorCode(parsed), message: String(parsed.error ?? parsed.message ?? "unknown_error") };
    }

    return null;
  }

  formatInput(msg) { return msg.content + "\n"; }
}

// ─── Codex CLI ──────────────────────────────────────────────────

/**
 * Codex CLI adapter (exec --json).
 *
 * stdin_mode: "close" — exec mode reads stdin(-) until EOF.
 * Output: thread.started → item.started/completed → turn.completed.
 */
export class CodexCliAdapter {
  cli_id = "codex";
  stdinMode = "close";
  sessionId = null;
  #lastText = "";

  buildArgs(options = {}) {
    const args = ["--dangerously-skip-permissions"];
    if (options.model) args.push("--model", options.model);
    if (options.systemPrompt) {
      const parts = [options.systemPrompt];
      if (options.allowedTools?.length) parts.push(`## Allowed Tools\nYou may ONLY use: ${options.allowedTools.join(", ")}`);
      args.push("--config", `developer_instructions=${parts.join("\n\n")}`);
    }
    args.push("exec", "--json");
    if (options.ephemeral) args.push("--ephemeral");
    if (options.sessionKey && UUID_RE.test(options.sessionKey)) args.push("resume", options.sessionKey);
    args.push("-");
    return args;
  }

  parse_output(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed;
    try { parsed = JSON.parse(trimmed); } catch (err) { console.warn(`[cli-adapter] codex JSON parse error: ${err?.message}`); return null; }
    const type = String(parsed.type ?? "");

    if (type === "thread.started") { this.sessionId = String(parsed.thread_id ?? ""); this.#lastText = ""; return null; }
    if (type === "turn.started") return null;

    if (type === "item.completed" || type === "item.started") {
      return this.#parseItem(parsed.item, type);
    }

    if (type === "turn.completed") {
      const usage = parsed.usage;
      return {
        type: "complete",
        result: this.#lastText,
        usage: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 } : undefined,
      };
    }

    if (type === "error") {
      return { type: "error", code: mapErrorCode(parsed), message: String(parsed.message ?? parsed.error ?? "unknown_error") };
    }

    return null;
  }

  formatInput(msg) { return msg.content + "\n"; }

  #parseItem(item, event) {
    if (!item) return null;
    const itemType = String(item.type ?? "");

    if (itemType === "agent_message" && event === "item.completed") {
      const text = String(item.text ?? "");
      if (text) this.#lastText = text;
      return { type: "assistant_chunk", content: text, delta: true };
    }

    if (itemType === "command_execution") {
      if (event === "item.started") return { type: "tool_use", tool: "shell", input: { command: String(item.command ?? "") } };
      if (event === "item.completed") return { type: "tool_result", tool: "shell", output: String(item.aggregated_output ?? "") };
    }

    if (itemType && itemType !== "agent_message") {
      if (event === "item.started") return { type: "tool_use", tool: itemType, input: extractToolInput(item) };
      if (event === "item.completed") return { type: "tool_result", tool: itemType, output: String(item.output ?? item.aggregated_output ?? "") };
    }

    return null;
  }
}

// ─── Gemini CLI ─────────────────────────────────────────────────

/**
 * Gemini CLI adapter (--output-format stream-json).
 *
 * stdin_mode: "close" — pipe mode reads stdin until EOF.
 * System prompt: via GEMINI_SYSTEM_MD env var (file path).
 * Output: init → message → tool_use/tool_result → result.
 */
export class GeminiCliAdapter {
  cli_id = "gemini";
  stdinMode = "close";
  sessionId = null;
  #lastText = "";

  buildArgs(options = {}) {
    const args = ["-p", "", "--output-format", "stream-json", "--approval-mode", "yolo"];
    if (options.model) args.push("--model", options.model);
    if (options.sessionKey && UUID_RE.test(options.sessionKey)) args.push("--resume", options.sessionKey);
    if (options.allowedTools?.length) args.push("--allowed-tools", options.allowedTools.join(","));
    if (options.mcpConfig) args.push("--extensions", options.mcpConfig);
    return args;
  }

  parse_output(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let parsed;
    try { parsed = JSON.parse(trimmed); } catch (err) { console.warn(`[cli-adapter] gemini JSON parse error: ${err?.message}`); return null; }
    const type = String(parsed.type ?? "");

    if (type === "init") { this.sessionId = String(parsed.session_id ?? ""); this.#lastText = ""; return null; }

    if (type === "message") {
      if (String(parsed.role ?? "") !== "assistant") return null;
      const content = String(parsed.content ?? "");
      if (!content) return null;
      this.#lastText += content;
      return { type: "assistant_chunk", content, delta: true };
    }

    if (type === "tool_use") return { type: "tool_use", tool: String(parsed.tool_name ?? "unknown"), input: parsed.parameters ?? {} };
    if (type === "tool_result") return { type: "tool_result", tool: String(parsed.tool_name ?? "unknown"), output: String(parsed.output ?? "") };

    if (type === "result") {
      const stats = parsed.stats;
      return {
        type: "complete",
        result: this.#lastText || String(parsed.response ?? ""),
        usage: stats ? { input: stats.input_tokens ?? 0, output: stats.output_tokens ?? 0 } : undefined,
      };
    }

    if (type === "error") {
      return { type: "error", code: mapErrorCode(parsed), message: String(parsed.message ?? parsed.error ?? "unknown_error") };
    }

    return null;
  }

  formatInput(msg) { return msg.content + "\n"; }
}

// ─── Factory ────────────────────────────────────────────────────

/** Providers that use HTTP API instead of CLI spawn. */
const API_ONLY_PROVIDERS = new Set(["ollama", "vllm", "openai", "anthropic"]);

/**
 * Create a CLI adapter by provider name.
 *
 * For CLI-based providers (claude, codex, gemini) returns a CliAdapter.
 * For API-based providers (ollama, vllm, openai, anthropic) throws with
 * guidance — use createApiAdapterFromSpec() from api-adapter.mjs instead.
 *
 * @param {"claude"|"codex"|"gemini"} provider
 * @returns {ClaudeCliAdapter|CodexCliAdapter|GeminiCliAdapter}
 */
export function createCliAdapter(provider) {
  switch (provider) {
    case "claude": return new ClaudeCliAdapter();
    case "codex": return new CodexCliAdapter();
    case "gemini": return new GeminiCliAdapter();
    default:
      if (API_ONLY_PROVIDERS.has(provider)) {
        throw new Error(
          `"${provider}" is an API provider — use createApiAdapterFromSpec("${provider}") from api-adapter.mjs instead of createCliAdapter().`,
        );
      }
      throw new Error(`Unknown CLI adapter: ${provider}. Available CLI: claude, codex, gemini. API: ollama, vllm, openai, anthropic.`);
  }
}

/**
 * Check if a provider uses API instead of CLI.
 * @param {string} provider
 * @returns {boolean}
 */
export function isApiProvider(provider) {
  return API_ONLY_PROVIDERS.has(provider);
}

// ─── Helpers ────────────────────────────────────────────────────

function extractToolResultText(block) {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (typeof c === "string") return c;
      if (c?.type === "text") return String(c.text ?? "");
      return "";
    }).filter(Boolean).join("\n");
  }
  return String(content ?? "");
}

function extractToolInput(item) {
  if (typeof item.arguments === "string") {
    try { return JSON.parse(item.arguments); } catch (err) { console.warn(`[cli-adapter] tool input parse error: ${err?.message}`); return { arguments: item.arguments }; }
  }
  const { type: _, call_id: _2, id: _3, status: _4, ...rest } = item;
  return rest;
}
