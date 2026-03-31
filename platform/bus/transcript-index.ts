/**
 * Transcript Index — visible-text extraction and search primitives.
 *
 * RTI-3A: Defines the contract for what constitutes "visible" text in a
 * transcript. Both the transcript pane (daemon UI) and the search index
 * use the same extraction logic — preventing phantom hits from hidden text.
 *
 * Visible text = what the operator actually sees in the transcript pane.
 * Hidden text = system reminders, raw JSON, internal metadata, tool input JSON.
 *
 * @module bus/transcript-index
 */

// ── Visibility classification ───────────────────────

/** Categories of transcript content. */
export type ContentVisibility = "visible" | "hidden" | "metadata";

/** A classified line from the transcript. */
export interface ClassifiedLine {
  /** Original line content. */
  text: string;
  /** Visibility classification. */
  visibility: ContentVisibility;
  /** Section type (user, assistant, thinking, tool, result). */
  section?: "user" | "assistant" | "thinking" | "tool" | "result";
  /** Original line index in the raw transcript. */
  rawIndex: number;
}

// ── Hidden text patterns ────────────────────────────

/** Patterns that indicate hidden/system-only content. */
const HIDDEN_PATTERNS = [
  /^<system-reminder>/,
  /^<\/system-reminder>/,
  /<system-reminder>.*<\/system-reminder>/s,
  /^<local-command-/,
  /^<\/local-command-/,
  /^<command-/,
  /^<\/command-/,
  /^</,
  /^<\/antml:/,
  /^<task-notification>/,
  /^<\/task-notification>/,
];

/** JSON fields that are metadata-only (not visible to operator). */
const METADATA_FIELDS = new Set([
  "id", "model", "usage", "stop_reason", "stop_sequence",
  "log_id", "object", "created", "system_fingerprint",
]);

// ── Extraction ──────────────────────────────────────

/**
 * Extract visible text from a raw NDJSON transcript line.
 *
 * This function mirrors the rendering logic of transcript-pane.tsx's
 * parseStreamJson() — what it renders is "visible", everything else is "hidden".
 *
 * The contract: if this function returns `visibility: "visible"`,
 * the transcript pane MUST render it. If it returns "hidden",
 * the search index MUST NOT include it.
 */
export function classifyLine(raw: string, rawIndex: number): ClassifiedLine {
  const trimmed = raw.trim();

  // Empty lines are visible (spacing)
  if (!trimmed) {
    return { text: "", visibility: "visible", rawIndex };
  }

  // Hidden patterns (system reminders, XML tags, etc.)
  for (const pattern of HIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { text: trimmed, visibility: "hidden", rawIndex };
    }
  }

  // Non-JSON lines are visible (plain text, section headers)
  if (!trimmed.startsWith("{")) {
    return { text: trimmed, visibility: "visible", rawIndex };
  }

  // JSON lines: classify based on content
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    // Malformed JSON → hidden (not displayed by transcript pane)
    return { text: trimmed, visibility: "hidden", rawIndex };
  }

  // User message → visible
  if ((obj.type === "message" && obj.role === "user") || (obj.role === "user" && obj.content)) {
    const content = extractTextContent(obj);
    return { text: content, visibility: "visible", section: "user", rawIndex };
  }

  // Block delta with text → visible
  if (obj.type === "content_block_delta" && obj.delta) {
    const delta = obj.delta as Record<string, unknown>;
    if (delta.type === "thinking_delta" && delta.thinking) {
      return { text: String(delta.thinking), visibility: "visible", section: "thinking", rawIndex };
    }
    if (delta.type === "text_delta" && delta.text) {
      return { text: String(delta.text), visibility: "visible", section: "assistant", rawIndex };
    }
    if (delta.type === "input_json_delta") {
      // Tool input JSON is NOT visible (explicitly skipped in transcript pane)
      return { text: "", visibility: "hidden", rawIndex };
    }
    if (delta.text) {
      return { text: String(delta.text), visibility: "visible", section: "assistant", rawIndex };
    }
  }

  // Block start: tool_use → visible (tool name)
  if (obj.type === "content_block_start" && obj.content_block) {
    const block = obj.content_block as Record<string, unknown>;
    if (block.type === "tool_use") {
      return { text: `[TOOL] ${block.name ?? "tool"}`, visibility: "visible", section: "tool", rawIndex };
    }
    if (block.type === "thinking") {
      return { text: "", visibility: "visible", section: "thinking", rawIndex };
    }
    if (block.type === "text") {
      return { text: "", visibility: "visible", section: "assistant", rawIndex };
    }
  }

  // Tool result → visible (truncated)
  if (obj.type === "tool_result" || (obj.type === "content_block_start" && (obj.content_block as Record<string, unknown>)?.type === "tool_result")) {
    const text = (obj.content ?? obj.output ?? "") as string;
    if (text) return { text: `[RESULT] ${String(text).slice(0, 80)}`, visibility: "visible", section: "result", rawIndex };
  }

  // Final result → visible
  if (obj.type === "result" && obj.result) {
    return { text: String(obj.result), visibility: "visible", section: "assistant", rawIndex };
  }

  // Assistant chunk → visible
  if (obj.type === "assistant" && obj.message) {
    const msg = obj.message as Record<string, unknown>;
    if (Array.isArray(msg.content)) {
      const texts: string[] = [];
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && block.text) texts.push(String(block.text));
        if (block.type === "tool_use") texts.push(`[TOOL] ${block.name ?? "tool"}`);
      }
      return { text: texts.join("\n"), visibility: "visible", section: "assistant", rawIndex };
    }
  }

  // Metadata-only JSON (usage, model info, etc.) → hidden
  const keys = Object.keys(obj);
  if (keys.every(k => METADATA_FIELDS.has(k) || k === "type")) {
    return { text: "", visibility: "metadata", rawIndex };
  }

  // Unknown JSON type → hidden (not rendered by transcript pane)
  return { text: trimmed, visibility: "hidden", rawIndex };
}

/**
 * Extract visible text lines from a full raw transcript.
 * Returns only the lines that would be displayed in the transcript pane.
 *
 * This is the SINGLE function that both transcript pane and search index
 * should use for text extraction.
 */
export function extractVisibleText(rawLines: string[]): string[] {
  const visible: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const classified = classifyLine(rawLines[i], i);
    if (classified.visibility === "visible" && classified.text) {
      visible.push(...classified.text.split("\n"));
    }
  }
  return visible;
}

/**
 * Check if a line contains hidden/system-only content.
 * Used for filtering before indexing.
 */
export function isHiddenContent(raw: string): boolean {
  const trimmed = raw.trim();
  for (const pattern of HIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

// ── Helpers ─────────────────────────────────────────

function extractTextContent(obj: Record<string, unknown>): string {
  const content = obj.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter(c => c.type === "text")
      .map(c => String(c.text ?? ""))
      .join("");
  }
  return "";
}
