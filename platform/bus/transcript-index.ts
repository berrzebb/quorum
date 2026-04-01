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
  /<system-reminder>.*<\/system-reminder>/s,
  /^<local-command-/,
  /^<command-/,
  /^<task-notification>/,
  /^<\//, // Catches all closing tags (</system-reminder>, </command-*, </*, etc.)
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

// ═══ RTI-3B: Transcript Index + Query Primitives ════════════════════════

// ── Types ───────────────────────────────────────────

/** Search scope for transcript queries. */
export type SearchScope = "session" | "provider" | "global";

/** A single search hit in the transcript. */
export interface TranscriptHit {
  /** Session that contains the hit. */
  sessionId: string;
  /** Line number within visible text (0-based). */
  line: number;
  /** Text excerpt around the match. */
  excerpt: string;
  /** Relevance score (higher = better). */
  score: number;
  /** Section type where the hit occurred. */
  section?: ClassifiedLine["section"];
}

/** Internal index entry. */
interface IndexEntry {
  /** Normalized tokens for matching. */
  tokens: string[];
  /** Original visible text. */
  text: string;
  /** Visible line number. */
  visibleLine: number;
  /** Section type. */
  section?: ClassifiedLine["section"];
}

// ── TranscriptIndex ─────────────────────────────────

/**
 * Append-friendly, session-scoped transcript index.
 *
 * Design:
 * - Incremental: append() adds lines without re-indexing existing entries.
 * - Token-based: text is normalized (lowercase, split on whitespace/punct).
 * - Bounded: each session's index is capped to prevent memory growth.
 * - Visible-only: only indexes text that passes the visibility contract.
 *
 * @since RTI-3B
 */
export class TranscriptIndex {
  /** Per-session index. Key: sessionId. */
  private sessions = new Map<string, IndexEntry[]>();

  /** Maximum entries per session (prevents unbounded growth). */
  private maxEntriesPerSession: number;

  constructor(maxEntriesPerSession = 50_000) {
    this.maxEntriesPerSession = maxEntriesPerSession;
  }

  /**
   * Append a raw transcript line to a session's index.
   * Only visible text is indexed (hidden content is silently skipped).
   * Returns true if the line was indexed, false if hidden/skipped.
   */
  append(sessionId: string, rawLine: string): boolean {
    const entries = this.getOrCreateSession(sessionId);

    // Cap check
    if (entries.length >= this.maxEntriesPerSession) return false;

    const classified = classifyLine(rawLine, entries.length);
    if (classified.visibility !== "visible" || !classified.text.trim()) {
      return false;
    }

    // Split multi-line text into individual index entries
    const lines = classified.text.split("\n").filter(l => l.trim());
    for (const line of lines) {
      if (entries.length >= this.maxEntriesPerSession) break;
      entries.push({
        tokens: tokenize(line),
        text: line,
        visibleLine: entries.length,
        section: classified.section,
      });
    }

    return true;
  }

  /**
   * Append multiple raw lines at once (batch).
   * Returns count of lines actually indexed.
   */
  appendBatch(sessionId: string, rawLines: string[]): number {
    let indexed = 0;
    for (const line of rawLines) {
      if (this.append(sessionId, line)) indexed++;
    }
    return indexed;
  }

  /**
   * Query a session's index.
   * Returns hits ranked by relevance (token overlap score).
   */
  query(sessionId: string, searchText: string, maxResults = 20): TranscriptHit[] {
    const entries = this.sessions.get(sessionId);
    if (!entries || entries.length === 0) return [];

    const queryTokens = tokenize(searchText);
    if (queryTokens.length === 0) return [];

    const hits: TranscriptHit[] = [];

    for (const entry of entries) {
      const score = computeScore(queryTokens, entry.tokens);
      if (score > 0) {
        hits.push({
          sessionId,
          line: entry.visibleLine,
          excerpt: entry.text.slice(0, 120),
          score,
          section: entry.section,
        });
      }
    }

    // Sort by score descending, then by line ascending (earlier = better for ties)
    hits.sort((a, b) => b.score - a.score || a.line - b.line);
    return hits.slice(0, maxResults);
  }

  /**
   * Query across all sessions (global scope).
   */
  queryAll(searchText: string, maxResults = 50): TranscriptHit[] {
    const allHits: TranscriptHit[] = [];
    for (const sessionId of this.sessions.keys()) {
      allHits.push(...this.query(sessionId, searchText, maxResults));
    }
    allHits.sort((a, b) => b.score - a.score || a.line - b.line);
    return allHits.slice(0, maxResults);
  }

  /** Get the number of indexed entries for a session. */
  entryCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.length ?? 0;
  }

  /** Get all indexed session IDs. */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** Clear a session's index. */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Clear all indices. */
  clearAll(): void {
    this.sessions.clear();
  }

  private getOrCreateSession(sessionId: string): IndexEntry[] {
    let entries = this.sessions.get(sessionId);
    if (!entries) {
      entries = [];
      this.sessions.set(sessionId, entries);
    }
    return entries;
  }
}

// ── Tokenization ────────────────────────────────────

/** Normalize text into searchable tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/** Compute token overlap score between query and entry. */
function computeScore(queryTokens: string[], entryTokens: string[]): number {
  if (queryTokens.length === 0 || entryTokens.length === 0) return 0;

  const entrySet = new Set(entryTokens);
  let matches = 0;

  for (const qt of queryTokens) {
    // Exact match
    if (entrySet.has(qt)) {
      matches += 2;
      continue;
    }
    // Prefix match (for partial typing)
    for (const et of entryTokens) {
      if (et.startsWith(qt) || qt.startsWith(et)) {
        matches += 1;
        break;
      }
    }
  }

  // Normalize by query length to get 0-1 range, then scale
  return matches / (queryTokens.length * 2);
}
