/**
 * Codex JSONL Parser — converts Codex CLI session logs to unified model.
 *
 * Codex stores sessions as JSONL with a simpler structure than Claude Code.
 * Each record has role + content, with tool calls embedded.
 */

import { readFileSync } from "node:fs";
import type { Session, Turn, Action, SessionParser } from "../session-model.js";

interface CodexRecord {
  id?: string;
  role?: string;        // "user" | "assistant" | "system" | "tool"
  content?: string | Array<{ type: string; text?: string; tool_call_id?: string; output?: string }>;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  timestamp?: string | number;
  session_id?: string;
  model?: string;
}

export const codexParser: SessionParser = {
  canParse(filePath: string, firstLine?: string): boolean {
    if (!filePath.endsWith(".jsonl")) return false;
    if (firstLine) {
      try {
        const obj = JSON.parse(firstLine);
        // Codex has tool_calls or function field, no "type" field like Claude
        return obj.role != null && obj.type == null;
      } catch { return false; }
    }
    return false;
  },

  parse(filePath: string): Session {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const records: CodexRecord[] = [];

    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip */ }
    }

    const sessionId = records.find(r => r.session_id)?.session_id
      ?? filePath.replace(/.*[/\\]/, "").replace(".jsonl", "");

    const turns: Turn[] = [];
    let seq = 0;

    for (const rec of records) {
      if (!rec.role || rec.role === "system") continue;

      const ts = rec.timestamp
        ? (typeof rec.timestamp === "number" ? rec.timestamp : new Date(rec.timestamp).getTime())
        : 0;
      const content = typeof rec.content === "string"
        ? rec.content
        : (Array.isArray(rec.content) ? rec.content.map(c => c.text ?? c.output ?? "").join("\n") : "");

      if (rec.role === "user" && content.trim()) {
        turns.push({ id: rec.id ?? `codex-u-${seq}`, sequence: seq++, role: "user", content, actions: [], timestamp: ts });
      } else if (rec.role === "assistant") {
        const actions: Action[] = [];
        if (rec.tool_calls) {
          for (const tc of rec.tool_calls) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.function.arguments); } catch { /* raw string */ }
            actions.push({ id: tc.id, type: "tool_call", tool: tc.function.name, input, timestamp: ts });
          }
        }
        turns.push({ id: rec.id ?? `codex-a-${seq}`, sequence: seq++, role: "assistant", content, actions, timestamp: ts });
      } else if (rec.role === "tool") {
        // Attach tool result to last assistant turn's actions
        const lastAssistant = [...turns].reverse().find(t => t.role === "assistant");
        if (lastAssistant && rec.content) {
          const output = typeof rec.content === "string" ? rec.content : JSON.stringify(rec.content);
          lastAssistant.actions.push({
            id: rec.id ?? `codex-tr-${seq}`,
            type: "tool_result",
            tool: "unknown",
            output: output.slice(0, 2000),
            timestamp: ts,
          });
        }
      }
    }

    const timestamps = turns.map(t => t.timestamp).filter(t => t > 0);
    return {
      id: sessionId,
      provider: "codex",
      startedAt: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      endedAt: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
      cwd: "",
      turns,
      metadata: { model: records.find(r => r.model)?.model, rawPath: filePath },
    };
  },
};
