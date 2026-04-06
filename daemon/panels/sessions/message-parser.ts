/**
 * Message Parser — converts ndjson stream into structured ChatMessage objects.
 *
 * Input: raw ndjson lines from mux capture or output file
 * Output: ChatMessage[] for rendering in TranscriptPane
 *
 * Message types:
 *   - user: user input text
 *   - assistant: model text output
 *   - thinking: model reasoning (collapsible)
 *   - tool_use: tool invocation (name + input summary)
 *   - tool_result: tool output (truncatable)
 *   - system: system messages (errors, etc.)
 */

export type ChatMessageType = "user" | "assistant" | "thinking" | "tool_use" | "tool_result" | "system" | "collapsed_group";

export interface ChatMessage {
  type: ChatMessageType;
  /** Primary content lines. */
  lines: string[];
  /** Tool name (for tool_use/tool_result). */
  toolName?: string;
  /** File path hint (for Read/Edit/Write tools). */
  filePath?: string;
  /** Whether the content is truncated. */
  truncated?: boolean;
  /** Tool use ID for matching use→result. */
  toolUseId?: string;
  /** Timestamp (ms). */
  timestamp?: number;
  /** Grouped items (for collapsed_group). */
  groupedItems?: Array<{ toolName: string; filePath?: string; toolUseId?: string }>;
  /** Count of items in group. */
  groupCount?: number;
}

/**
 * Parse ndjson lines into structured ChatMessage objects.
 * Accumulates streaming deltas into complete messages.
 */
export function parseMessages(rawLines: string[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let currentMsg: ChatMessage | null = null;
  let currentToolUseId: string | null = null;
  let toolInputJson = "";

  function flush() {
    if (currentMsg && currentMsg.lines.length > 0) {
      messages.push(currentMsg);
    }
    currentMsg = null;
  }

  function ensureMsg(type: ChatMessageType): ChatMessage {
    if (!currentMsg || currentMsg.type !== type) {
      flush();
      currentMsg = { type, lines: [] };
    }
    return currentMsg;
  }

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;

    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }

    // ── User message ──
    if ((obj.type === "message" && obj.role === "user") || (obj.role === "user" && obj.content)) {
      const msg = ensureMsg("user");
      const content = typeof obj.content === "string"
        ? obj.content
        : Array.isArray(obj.content)
          ? obj.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
          : "";
      if (content) msg.lines.push(...content.split("\n"));
      continue;
    }

    // ── Block start ──
    if (obj.type === "content_block_start" && obj.content_block) {
      const block = obj.content_block;
      const btype = block.type ?? "text";

      if (btype === "thinking") {
        ensureMsg("thinking");
      } else if (btype === "tool_use") {
        flush();
        currentToolUseId = block.id ?? null;
        toolInputJson = "";
        const name = block.name ?? "tool";
        const filePath = extractFilePath(block.input);
        currentMsg = {
          type: "tool_use",
          lines: [],
          toolName: name,
          filePath,
          toolUseId: currentToolUseId ?? undefined,
        };
      } else if (btype === "text") {
        ensureMsg("assistant");
      }
      continue;
    }

    // ── Block delta ──
    if (obj.type === "content_block_delta" && obj.delta) {
      const d = obj.delta;
      if (d.type === "thinking_delta" && d.thinking) {
        const msg = ensureMsg("thinking");
        msg.lines.push(...d.thinking.split("\n"));
      } else if (d.type === "text_delta" && d.text) {
        const msg = ensureMsg("assistant");
        msg.lines.push(...d.text.split("\n"));
      } else if (d.type === "input_json_delta" && d.partial_json) {
        // Accumulate tool input JSON for summary extraction
        toolInputJson += d.partial_json;
      } else if (d.text) {
        const msg = ensureMsg("assistant");
        msg.lines.push(...d.text.split("\n"));
      }
      continue;
    }

    // ── Block stop ──
    if (obj.type === "content_block_stop") {
      // If we have accumulated tool input, extract summary
      if (currentMsg?.type === "tool_use" && toolInputJson) {
        try {
          const input = JSON.parse(toolInputJson);
          const filePath = extractFilePath(input);
          if (filePath) currentMsg.filePath = filePath;
          // Add command summary for Bash
          if (currentMsg.toolName === "Bash" && input.command) {
            currentMsg.lines.push(input.command.slice(0, 80));
          }
          // Add pattern for Grep/Glob
          if (input.pattern) {
            currentMsg.lines.push(input.pattern);
          }
        } catch { /* partial json */ }
        toolInputJson = "";
      }
      flush();
      continue;
    }

    // ── Tool result ──
    if (obj.type === "tool_result" || (obj.content_block?.type === "tool_result")) {
      flush();
      const content = obj.content ?? obj.output ?? "";
      const text = typeof content === "string" ? content : JSON.stringify(content);
      const lines = text.split("\n");
      const truncated = lines.length > 10;
      currentMsg = {
        type: "tool_result",
        lines: truncated ? [...lines.slice(0, 8), `  ... (${lines.length - 8} more lines)`] : lines,
        truncated,
        toolUseId: obj.tool_use_id ?? currentToolUseId ?? undefined,
      };
      flush();
      continue;
    }

    // ── Result (final) ──
    if (obj.type === "result" && obj.result) {
      const msg = ensureMsg("assistant");
      msg.lines.push(...String(obj.result).split("\n"));
      continue;
    }

    // ── Claude Code assistant chunk format ──
    if (obj.type === "assistant" && obj.message?.content) {
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) {
          const msg = ensureMsg("assistant");
          msg.lines.push(...block.text.split("\n"));
        }
        if (block.type === "tool_use") {
          flush();
          const filePath = extractFilePath(block.input);
          currentMsg = {
            type: "tool_use",
            lines: block.input?.command ? [block.input.command.slice(0, 80)] : [],
            toolName: block.name ?? "tool",
            filePath,
            toolUseId: block.id,
          };
          flush();
        }
      }
      continue;
    }

    // ── System / error ──
    if (obj.type === "error" || obj.error) {
      flush();
      const errMsg = obj.error?.message ?? obj.message ?? "unknown error";
      messages.push({ type: "system", lines: [`Error: ${errMsg}`] });
      continue;
    }
  }

  flush();
  return collapseReadSearchGroups(messages);
}

/** Collapsible tool names — consecutive runs get merged. */
const COLLAPSIBLE_TOOLS = new Set(["Read", "Grep", "Glob", "LS"]);

/**
 * Post-process: collapse consecutive Read/Grep/Glob tool_use + tool_result
 * into a single collapsed_group message.
 */
function collapseReadSearchGroups(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let groupBuffer: ChatMessage[] = [];

  function flushGroup() {
    if (groupBuffer.length === 0) return;
    if (groupBuffer.length <= 2) {
      // Too few to collapse — keep as-is
      result.push(...groupBuffer);
    } else {
      // Collapse: extract tool_use items (skip tool_results)
      const items = groupBuffer
        .filter(m => m.type === "tool_use")
        .map(m => ({ toolName: m.toolName ?? "tool", filePath: m.filePath, toolUseId: m.toolUseId }));
      const toolCounts = new Map<string, number>();
      for (const item of items) {
        toolCounts.set(item.toolName, (toolCounts.get(item.toolName) ?? 0) + 1);
      }
      const summary = [...toolCounts.entries()].map(([name, count]) => `${name} ×${count}`).join(", ");
      result.push({
        type: "collapsed_group",
        lines: [summary],
        toolName: items[0]?.toolName,
        groupedItems: items,
        groupCount: items.length,
      });
    }
    groupBuffer = [];
  }

  for (const msg of messages) {
    if (msg.type === "tool_use" && COLLAPSIBLE_TOOLS.has(msg.toolName ?? "")) {
      groupBuffer.push(msg);
    } else if (msg.type === "tool_result" && groupBuffer.length > 0) {
      groupBuffer.push(msg);
    } else {
      flushGroup();
      result.push(msg);
    }
  }
  flushGroup();
  return result;
}

/** Extract file_path from tool input (Read, Edit, Write, Glob, Grep). */
function extractFilePath(input: any): string | undefined {
  if (!input) return undefined;
  const raw = input.file_path ?? input.path ?? input.file ?? undefined;
  if (!raw || typeof raw !== "string") return undefined;
  // Shorten to filename or last 2 segments
  const parts = raw.replace(/\\/g, "/").split("/");
  return parts.length <= 2 ? raw : parts.slice(-2).join("/");
}
