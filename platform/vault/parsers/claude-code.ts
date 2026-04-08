/**
 * Claude Code JSONL Parser — converts Claude Code session logs to unified model.
 *
 * Format: NDJSON with UUID parent-child chains.
 * Record types: user, assistant, system, file-history-snapshot, attachment,
 *               queue-operation, last-prompt, custom-title, agent-name.
 *
 * Turn reconstruction: user(text) → assistant(text+tool_use) → user(tool_result) → assistant(text)
 * Actions: tool_use content blocks + matching tool_result blocks (linked by tool_use_id).
 */

import { readFileSync } from "node:fs";
import type { Session, Turn, Action, SessionParser, TokenUsage } from "../session-model.js";

// ── Raw JSONL Types ─────────────────────────────

interface RawRecord {
  uuid: string;
  parentUuid?: string;
  type: string;            // "user" | "assistant" | "system" | "file-history-snapshot" | ...
  isSidechain?: boolean;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  gitBranch?: string;
  cwd?: string;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface ContentBlock {
  type: string;           // "text" | "tool_use" | "tool_result" | "thinking"
  text?: string;
  thinking?: string;
  name?: string;          // tool name (tool_use)
  id?: string;            // tool_use_id
  input?: Record<string, unknown>;
  tool_use_id?: string;   // tool_result → matches tool_use.id
  content?: string;       // tool_result output
  is_error?: boolean;
}

// ── Parser ──────────────────────────────────────

export const claudeCodeParser: SessionParser = {
  canParse(filePath: string, firstLine?: string): boolean {
    if (filePath.endsWith(".jsonl")) {
      if (firstLine) {
        try {
          const obj = JSON.parse(firstLine);
          return obj.type === "file-history-snapshot" || obj.sessionId != null || obj.version != null;
        } catch { return false; }
      }
      return true; // .jsonl default to Claude Code
    }
    return false;
  },

  parse(filePath: string): Session {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const records: RawRecord[] = [];

    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }

    // Extract session metadata from first meaningful record
    const meta = records.find(r => r.sessionId || r.version);
    const sessionId = meta?.sessionId ?? filePath.replace(/.*[/\\]/, "").replace(".jsonl", "");

    // Separate conversation records (user/assistant) from metadata
    const convRecords = records.filter(r =>
      (r.type === "user" || r.type === "assistant") && r.message,
    );

    // Build turns: group user message → assistant response(s)
    const turns: Turn[] = [];
    let seq = 0;

    for (let i = 0; i < convRecords.length; i++) {
      const rec = convRecords[i]!;
      const ts = rec.timestamp ? new Date(rec.timestamp).getTime() : 0;

      if (rec.type === "user" && rec.message?.role === "user") {
        const content = extractTextContent(rec.message.content);
        // Skip tool_result-only user messages (they're actions, not turns)
        const blocks = Array.isArray(rec.message.content) ? rec.message.content : [];
        const hasOnlyToolResults = blocks.length > 0 && blocks.every(b => b.type === "tool_result");
        if (hasOnlyToolResults) continue;

        if (content.trim()) {
          turns.push({
            id: rec.uuid,
            sequence: seq++,
            role: "user",
            content,
            actions: [],
            timestamp: ts,
          });
        }
      } else if (rec.type === "assistant" && rec.message?.role === "assistant") {
        const { text, thinking } = extractAssistantContent(rec.message.content);
        const actions = extractActions(rec, convRecords, i);
        const usage = extractUsage(rec.message.usage);

        turns.push({
          id: rec.uuid,
          sequence: seq++,
          role: "assistant",
          content: text,
          thinking: thinking || undefined,
          actions,
          timestamp: ts,
          usage,
        });
      }
    }

    // Determine timestamps
    const timestamps = convRecords
      .map(r => r.timestamp ? new Date(r.timestamp).getTime() : 0)
      .filter(t => t > 0);

    return {
      id: sessionId,
      provider: "claude-code",
      startedAt: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      endedAt: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
      cwd: meta?.cwd ?? "",
      turns,
      metadata: {
        version: meta?.version,
        gitBranch: meta?.gitBranch,
        rawPath: filePath,
      },
    };
  },
};

// ── Helpers ──────────────────────────────────────

function extractTextContent(content: ContentBlock[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter(b => b.type === "text")
    .map(b => b.text ?? "")
    .join("\n");
}

function extractAssistantContent(content: ContentBlock[] | string | undefined): { text: string; thinking: string } {
  if (!content) return { text: "", thinking: "" };
  if (typeof content === "string") return { text: content, thinking: "" };

  const text = content.filter(b => b.type === "text").map(b => b.text ?? "").join("\n");
  const thinking = content.filter(b => b.type === "thinking").map(b => b.thinking ?? "").join("\n");
  return { text, thinking };
}

function extractActions(
  assistantRec: RawRecord,
  allRecords: RawRecord[],
  assistantIdx: number,
): Action[] {
  const actions: Action[] = [];
  const content = assistantRec.message?.content;
  if (!Array.isArray(content)) return actions;
  const ts = assistantRec.timestamp ? new Date(assistantRec.timestamp).getTime() : 0;

  // Extract tool_use blocks from assistant message
  const toolUses = content.filter(b => b.type === "tool_use" && b.name && b.id);
  for (const tu of toolUses) {
    actions.push({
      id: tu.id!,
      type: "tool_call",
      tool: tu.name!,
      input: tu.input,
      timestamp: ts,
    });
  }

  // Find matching tool_results in subsequent user messages
  for (let j = assistantIdx + 1; j < allRecords.length && j < assistantIdx + 5; j++) {
    const next = allRecords[j]!;
    if (next.type !== "user") break;
    const blocks = Array.isArray(next.message?.content) ? next.message!.content as ContentBlock[] : [];
    for (const b of blocks) {
      if (b.type === "tool_result" && b.tool_use_id) {
        const nextTs = next.timestamp ? new Date(next.timestamp).getTime() : ts;
        actions.push({
          id: b.tool_use_id,
          type: "tool_result",
          tool: toolUses.find(tu => tu.id === b.tool_use_id)?.name ?? "unknown",
          output: typeof b.content === "string" ? b.content.slice(0, 2000) : undefined,
          error: b.is_error ?? false,
          timestamp: nextTs,
        });
      }
    }
  }

  return actions;
}

function extractUsage(usage: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const input = (usage.input_tokens as number) ?? 0;
  const output = (usage.output_tokens as number) ?? 0;
  if (!input && !output) return undefined;
  return {
    input,
    output,
    cacheRead: usage.cache_read_input_tokens as number | undefined,
    cacheWrite: usage.cache_creation_input_tokens as number | undefined,
  };
}
