/**
 * OpenAI-Compatible Auditor — base class for Ollama, vLLM, and other
 * providers that implement the OpenAI chat completions API.
 *
 * Key difference from OpenAIAuditor: supports **tool calling loops**.
 * The LLM can invoke quorum's deterministic analysis tools (code_map,
 * blast_radius, audit_scan, etc.) during audits for deeper inspection.
 *
 * Flow:
 *   1. Send prompt + tool definitions to /v1/chat/completions
 *   2. If response contains tool_calls → execute locally → send results back
 *   3. Repeat until LLM returns final text (max rounds capped)
 *   4. Parse verdict JSON from final response
 */

import type { Auditor, AuditRequest, AuditResult } from "../provider.js";
import { parseAuditResponse } from "./parse.js";

// ── Types ────────────────────────────────────────────

/** Tool definition in OpenAI function calling format. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: "stop" | "tool_calls" | "length" | null;
}

interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── Configuration ────────────────────────────────────

export interface OpenAICompatibleConfig {
  /** API key (optional for local providers like Ollama). */
  apiKey?: string;
  /** Model name. */
  model?: string;
  /** Base URL for the OpenAI-compatible API. */
  baseUrl?: string;
  /** Request timeout in ms (default: 180s — longer for local models). */
  timeout?: number;
  /** Maximum tool calling rounds before forcing final answer (default: 5). */
  maxToolRounds?: number;
  /** Enable tool calling. true = use default audit tools, false = disable. */
  enableTools?: boolean;
  /** Custom tool executor. If omitted, uses built-in quorum tool dispatch. */
  toolExecutor?: ToolExecutor;
}

/**
 * Executes a tool by name with given arguments.
 * Returns the tool output as a string.
 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

// ── Audit tool catalog ───────────────────────────────
// Read-only analysis tools safe for LLM invocation during audits.
// Excludes: audit_submit (circular), fvm_validate (needs live server),
// agent_comm (inter-agent), rtm_merge (write operation).

const AUDIT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "code_map",
      description: "Generate symbol index for a directory or file. Returns function/class/type declarations with line ranges.",
      parameters: {
        type: "object",
        properties: {
          path:   { type: "string", description: "File or directory path to scan" },
          filter: { type: "string", description: "Comma-separated types: fn, method, class, iface, type, enum, import" },
          depth:  { type: "number", description: "Max directory depth (default: 5)" },
          format: { type: "string", enum: ["detail", "matrix"], description: "Output format" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "blast_radius",
      description: "Compute transitive impact of changed files via reverse import graph. Returns affected file count and chains.",
      parameters: {
        type: "object",
        properties: {
          changed_files: { type: "array", items: { type: "string" }, description: "Files that changed (relative paths)" },
          path:      { type: "string", description: "Repository root (default: cwd)" },
          max_depth: { type: "number", description: "BFS depth limit (default: 10)" },
        },
        required: ["changed_files"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_scan",
      description: "Run pattern scan for type-safety issues, hardcoded strings, console.log, and anti-patterns.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Scan pattern: all, type-safety, hardcoded, console" },
          path:    { type: "string", description: "Target path to scan" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dependency_graph",
      description: "Build import/export dependency graph. Returns components, topological order, and cycle detection.",
      parameters: {
        type: "object",
        properties: {
          path:  { type: "string", description: "Directory or file to analyze" },
          depth: { type: "number", description: "Max directory depth (default: 5)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "perf_scan",
      description: "Scan for performance anti-patterns: nested loops, sync I/O, unbounded queries, heavy imports.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory or file to scan" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "a11y_scan",
      description: "Scan JSX/TSX for accessibility issues: missing alt, onClick without keyboard, form labels.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory or file to scan" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "license_scan",
      description: "Check dependency licenses for copyleft/unknown risks and scan source for hardcoded secrets.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project root to scan" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "observability_check",
      description: "Detect observability gaps: empty catch blocks, missing error logging, console.log in production.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory or file to scan" },
        },
      },
    },
  },
];

// ── Default tool executor (loads quorum tool-core lazily) ─

let _toolCore: Record<string, Function> | null = null;

async function loadToolCore(): Promise<Record<string, Function>> {
  if (_toolCore) return _toolCore;

  // Resolve tool-core.mjs relative to this module's compiled location
  // dist/platform/providers/auditors/openai-compatible.js → ../../../../platform/core/tools/tool-core.mjs
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const toolCorePath = join(here, "..", "..", "..", "..", "platform", "core", "tools", "tool-core.mjs");

  try {
    _toolCore = await import(toolCorePath);
    return _toolCore!;
  } catch (err) {
    // Fallback: try relative path from source location
    console.warn(`[openai-compatible] tool-core load failed at ${toolCorePath}: ${(err as Error).message}`);
    try {
      // @ts-expect-error — MJS module without type declarations
      _toolCore = await import("../../core/tools/tool-core.mjs");
      return _toolCore!;
    } catch (err2) {
      console.warn(`[openai-compatible] tool-core fallback load also failed: ${(err2 as Error).message}`);
      _toolCore = {};
      return _toolCore;
    }
  }
}

const TOOL_FN_MAP: Record<string, string> = {
  code_map:            "toolCodeMap",
  blast_radius:        "toolBlastRadius",
  audit_scan:          "toolAuditScan",
  dependency_graph:    "toolDependencyGraph",
  perf_scan:           "toolPerfScan",
  a11y_scan:           "toolA11yScan",
  license_scan:        "toolLicenseScan",
  observability_check: "toolObservabilityCheck",
};

async function defaultToolExecutor(name: string, args: Record<string, unknown>): Promise<string> {
  const core = await loadToolCore();
  const fnName = TOOL_FN_MAP[name];
  if (!fnName || typeof core[fnName] !== "function") {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  try {
    const result = core[fnName](args);
    if (result.error) return `Error: ${result.error}`;
    const tag = result.cached ? " [cached]" : "";
    return `${result.text ?? ""}${result.summary ? `\n\n(${result.summary}${tag})` : ""}`;
  } catch (err) {
    return `Tool execution error: ${(err as Error).message}`;
  }
}

// ── OpenAI-Compatible Auditor ────────────────────────

export class OpenAICompatibleAuditor implements Auditor {
  protected apiKey: string;
  protected model: string;
  protected baseUrl: string;
  protected timeout: number;
  protected maxToolRounds: number;
  protected enableTools: boolean;
  protected toolExecutor: ToolExecutor;

  constructor(config: OpenAICompatibleConfig = {}) {
    this.apiKey = config.apiKey ?? "";
    this.model = config.model ?? "default";
    this.baseUrl = (config.baseUrl ?? "http://localhost:8000/v1").replace(/\/+$/, "");
    this.timeout = config.timeout ?? 180_000;
    this.maxToolRounds = config.maxToolRounds ?? 5;
    this.enableTools = config.enableTools !== false;
    this.toolExecutor = config.toolExecutor ?? defaultToolExecutor;
  }

  async audit(request: AuditRequest): Promise<AuditResult> {
    const start = Date.now();

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "You are a code auditor. Review the evidence and changed files. " +
          (this.enableTools
            ? "You may use the provided tools to inspect code structure, dependencies, and patterns before making your judgment. "
            : "") +
          "Respond with ONLY a JSON object: " +
          '{"verdict": "approved" | "changes_requested" | "infra_failure", "codes": [...], "summary": "..."}',
      },
      {
        role: "user",
        content: formatPrompt(request),
      },
    ];

    try {
      return await this.runWithToolLoop(messages, start);
    } catch (err) {
      return {
        verdict: "infra_failure",
        codes: ["auditor-error"],
        summary: `API error: ${(err as Error).message}`,
        raw: "",
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Core tool calling loop.
   * Sends messages to the LLM, executes any tool calls, and repeats
   * until the LLM returns a final text response or max rounds are hit.
   */
  private async runWithToolLoop(messages: ChatMessage[], start: number): Promise<AuditResult> {
    let round = 0;

    while (round < this.maxToolRounds) {
      const response = await this.callApi(messages);

      if (!response.choices?.length) {
        return {
          verdict: "infra_failure",
          codes: ["auditor-error"],
          summary: "Empty response from API",
          raw: JSON.stringify(response),
          duration: Date.now() - start,
        };
      }

      const choice = response.choices[0]!;
      const assistantMsg = choice.message;

      // If no tool calls, we have the final response
      if (!assistantMsg.tool_calls?.length || choice.finish_reason === "stop") {
        const raw = assistantMsg.content ?? "";
        return parseAuditResponse(raw, Date.now() - start);
      }

      // Append assistant message (with tool_calls) to conversation
      messages.push({
        role: "assistant",
        content: assistantMsg.content,
        tool_calls: assistantMsg.tool_calls,
      });

      // Execute each tool call and append results
      for (const toolCall of assistantMsg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (err) { console.warn(`[openai-compatible] tool call args parse failed: ${(err as Error).message}`); }

        const result = await this.toolExecutor(toolCall.function.name, args);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      round++;
    }

    // Max rounds exceeded — extract whatever we have
    const lastAssistant = messages.filter(m => m.role === "assistant").pop();
    const raw = lastAssistant?.content ?? "";
    if (raw) {
      return parseAuditResponse(raw, Date.now() - start);
    }

    return {
      verdict: "infra_failure",
      codes: ["max-tool-rounds"],
      summary: `Tool calling loop exceeded ${this.maxToolRounds} rounds without verdict`,
      raw: "",
      duration: Date.now() - start,
    };
  }

  /**
   * Make a single chat completions API call.
   * Subclasses can override for provider-specific quirks.
   */
  protected async callApi(messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.2,
    };

    // Add tools if enabled and any tool calls haven't been resolved yet
    if (this.enableTools) {
      body.tools = AUDIT_TOOLS;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Only add Authorization header if API key is provided
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`API ${response.status}: ${err.slice(0, 300)}`);
      }

      return await response.json() as ChatCompletionResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  async available(): Promise<boolean> {
    // Default: try to reach the API. Subclasses override with specific checks.
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
      return res.ok;
    } catch (err) {
      console.warn(`[openai-compatible] availability check failed: ${(err as Error).message}`);
      return false;
    }
  }
}

// ── Helpers ──────────────────────────────────────────

function formatPrompt(request: AuditRequest): string {
  return [
    request.prompt,
    "",
    "## Evidence",
    "",
    request.evidence,
    "",
    "## Changed Files",
    "",
    ...request.files.map(f => `- ${f}`),
    "",
    "Respond with JSON:",
    '{"verdict": "approved" | "changes_requested" | "infra_failure", "codes": [], "summary": "..."}',
  ].join("\n");
}
