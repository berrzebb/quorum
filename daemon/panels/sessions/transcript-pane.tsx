/**
 * TranscriptPane — scrollable transcript output viewport.
 *
 * Extracted from AgentChatPanel.tsx (Col 2: Output pane).
 * Renders a visible slice of transcript lines with scroll indicator.
 */

import React from "react";
import { Box, Text } from "ink";

interface TranscriptPaneProps {
  lines: string[];
  scrollOffset: number;
  height: number;
  sessionId: string;
  /** Selected role name for header display. */
  role?: string;
  /** Backend name for header display. */
  backend?: string;
}

const MAX_BUFFER_LINES = 200;

// ── NDJSON parser ─────────────────────────────────────────────────────

/**
 * Parse NDJSON stream output into displayable message lines.
 *
 * Handles Claude streaming format:
 * - content_block_delta with delta.text
 * - message with role=user
 * - result with result text
 *
 * Filters to assistant/user messages only (as per daemon chat filter feedback).
 */
export function parseStreamJson(rawLines: string[]): string[] {
  const messageParts: string[] = [];
  let lastRole: "assistant" | "user" | null = null;

  const joined = rawLines.map(l => l.trimEnd()).join("");
  const entries = joined.split(/(?=\{"(?:type|role)":)/);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);

      if ((obj.type === "message" && obj.role === "user") || (obj.role === "user" && obj.content)) {
        if (lastRole !== "user") messageParts.push("\n───");
        lastRole = "user";
        const content = typeof obj.content === "string"
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text : "").join("")
            : "";
        if (content) messageParts.push(`[USER] ${content}`);
        continue;
      }

      if (obj.type === "content_block_delta" && obj.delta?.text) {
        if (lastRole !== "assistant") { messageParts.push("\n───"); lastRole = "assistant"; }
        messageParts.push(obj.delta.text);
        continue;
      }

      if (obj.type === "result" && obj.result) {
        if (lastRole !== "assistant") { messageParts.push("\n───"); lastRole = "assistant"; }
        messageParts.push(obj.result);
        continue;
      }
    } catch { /* not JSON — skip */ }
  }

  if (messageParts.length === 0) return rawLines;
  return messageParts.join("").split("\n").filter(Boolean).slice(-MAX_BUFFER_LINES);
}

// ── TranscriptPane Component ──────────────────────────────────────────

export function TranscriptPane({ lines, scrollOffset, height, sessionId: _sessionId, role, backend }: TranscriptPaneProps) {
  const visibleLines = Math.max(height, 5);
  const maxScroll = Math.max(0, lines.length - visibleLines);
  const safeOffset = Math.min(scrollOffset, maxScroll);
  const startIdx = Math.max(0, lines.length - visibleLines - safeOffset);
  const displayLines = lines.slice(startIdx, startIdx + visibleLines);

  const scrollPct = lines.length > visibleLines
    ? Math.round(((lines.length - safeOffset - visibleLines) / (lines.length - visibleLines)) * 100)
    : 100;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          {role ?? "agent"} <Text dimColor>{backend ?? ""}</Text>
        </Text>
        <Text dimColor>
          {safeOffset > 0 ? `▲${safeOffset}` : ""} {lines.length}L {scrollPct}%
        </Text>
      </Box>
      <Text dimColor>{"─".repeat(40)}</Text>

      {/* Scrollable output */}
      <Box flexDirection="column" height={visibleLines}>
        {displayLines.length === 0 ? (
          <Text dimColor>waiting for output...</Text>
        ) : (
          displayLines.map((line, i) => (
            <Text key={startIdx + i} wrap="truncate-end">{line}</Text>
          ))
        )}
      </Box>

      {/* Scroll indicator bar */}
      {lines.length > visibleLines && (
        <Text dimColor>
          {safeOffset > 0 ? "▲ " : "  "}
          {"─".repeat(20)}
          {startIdx > 0 ? " ▼" : "  "}
        </Text>
      )}
    </Box>
  );
}
