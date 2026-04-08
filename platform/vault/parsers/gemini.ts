/**
 * Gemini JSON Parser — converts Gemini CLI session logs to unified model.
 *
 * Gemini stores sessions as JSON arrays or JSONL with parts-based content.
 */

import { readFileSync } from "node:fs";
import type { Session, Turn, Action, SessionParser } from "../session-model.js";

interface GeminiRecord {
  role?: string;          // "user" | "model"
  parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: unknown } }>;
  timestamp?: string | number;
  session_id?: string;
  model?: string;
}

export const geminiParser: SessionParser = {
  canParse(filePath: string, firstLine?: string): boolean {
    if (filePath.endsWith(".json")) return true;
    if (!filePath.endsWith(".jsonl") || !firstLine) return false;
    try {
      const obj = JSON.parse(firstLine);
      return obj.parts != null || obj.role === "model";
    } catch { return false; }
  },

  parse(filePath: string): Session {
    const raw = readFileSync(filePath, "utf8");
    let records: GeminiRecord[];

    // JSON array or JSONL
    if (raw.trimStart().startsWith("[")) {
      try { records = JSON.parse(raw); } catch { records = []; }
    } else {
      records = raw.split("\n").filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean) as GeminiRecord[];
    }

    const sessionId = records.find(r => r.session_id)?.session_id
      ?? filePath.replace(/.*[/\\]/, "").replace(/\.(json|jsonl)$/, "");

    const turns: Turn[] = [];
    let seq = 0;

    for (const rec of records) {
      if (!rec.role || !rec.parts) continue;

      const ts = rec.timestamp
        ? (typeof rec.timestamp === "number" ? rec.timestamp : new Date(rec.timestamp).getTime())
        : 0;

      const textParts = rec.parts.filter(p => p.text).map(p => p.text!).join("\n");
      const role = rec.role === "model" ? "assistant" as const : "user" as const;

      const actions: Action[] = [];
      for (const part of rec.parts) {
        if (part.functionCall) {
          actions.push({
            id: `gemini-fc-${seq}-${actions.length}`,
            type: "tool_call",
            tool: part.functionCall.name,
            input: part.functionCall.args,
            timestamp: ts,
          });
        }
        if (part.functionResponse) {
          actions.push({
            id: `gemini-fr-${seq}-${actions.length}`,
            type: "tool_result",
            tool: part.functionResponse.name,
            output: typeof part.functionResponse.response === "string"
              ? part.functionResponse.response.slice(0, 2000)
              : JSON.stringify(part.functionResponse.response).slice(0, 2000),
            timestamp: ts,
          });
        }
      }

      if (textParts.trim() || actions.length > 0) {
        turns.push({ id: `gemini-${seq}`, sequence: seq++, role, content: textParts, actions, timestamp: ts });
      }
    }

    const timestamps = turns.map(t => t.timestamp).filter(t => t > 0);
    return {
      id: sessionId,
      provider: "gemini",
      startedAt: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      endedAt: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
      cwd: "",
      turns,
      metadata: { model: records.find(r => r.model)?.model, rawPath: filePath },
    };
  },
};
