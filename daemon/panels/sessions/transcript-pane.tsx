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
  focused?: boolean;
}

const MAX_BUFFER_LINES = 200;

// ── NDJSON parser ─────────────────────────────────────────────────────

/**
 * Parse NDJSON stream output into displayable message lines.
 *
 * Handles Claude/Codex streaming format — line by line:
 * - content_block_start: detect thinking/text/tool_use block type
 * - content_block_delta: text_delta, thinking_delta, input_json_delta
 * - message with role=user
 * - result with result text
 * - tool_use / tool_result summaries
 *
 * Renders: [THINK] prefix for thinking, [TOOL] for tool use, plain text for chat.
 */
export function parseStreamJson(rawLines: string[]): string[] {
  const output: string[] = [];
  let lastSection: "user" | "assistant" | "thinking" | "tool" | null = null;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;

    let obj: any;
    try { obj = JSON.parse(line); } catch (err) { console.warn(`[transcript-pane] NDJSON parse failed: ${(err as Error).message}`); continue; }

    // User message
    if ((obj.type === "message" && obj.role === "user") || (obj.role === "user" && obj.content)) {
      if (lastSection !== "user") { output.push("", "─── USER ───"); lastSection = "user"; }
      const content = typeof obj.content === "string"
        ? obj.content
        : Array.isArray(obj.content)
          ? obj.content.map((c: any) => c.type === "text" ? c.text : "").join("")
          : "";
      if (content) output.push(content);
      continue;
    }

    // Block start — detect type
    if (obj.type === "content_block_start" && obj.content_block) {
      const btype = obj.content_block.type ?? "text";
      if (btype === "thinking" && lastSection !== "thinking") {
        output.push("", "─── THINKING ───");
        lastSection = "thinking";
      } else if (btype === "tool_use") {
        if (lastSection !== "tool") { output.push(""); lastSection = "tool"; }
        output.push(`[TOOL] ${obj.content_block.name ?? "tool"}`);
      } else if (btype === "text" && lastSection !== "assistant") {
        output.push("", "─── ASSISTANT ───");
        lastSection = "assistant";
      }
      continue;
    }

    // Block delta — content
    if (obj.type === "content_block_delta" && obj.delta) {
      const d = obj.delta;
      if (d.type === "thinking_delta" && d.thinking) {
        if (lastSection !== "thinking") { output.push("", "─── THINKING ───"); lastSection = "thinking"; }
        output.push(...d.thinking.split("\n"));
      } else if (d.type === "text_delta" && d.text) {
        if (lastSection !== "assistant") { output.push("", "─── ASSISTANT ───"); lastSection = "assistant"; }
        output.push(...d.text.split("\n"));
      } else if (d.type === "input_json_delta") {
        // tool input — skip verbose JSON, already shown tool name
      } else if (d.text) {
        // Legacy format: delta.text without type prefix
        if (lastSection !== "assistant") { output.push("", "─── ASSISTANT ───"); lastSection = "assistant"; }
        output.push(...d.text.split("\n"));
      }
      continue;
    }

    // Tool result
    if (obj.type === "tool_result" || (obj.type === "content_block_start" && obj.content_block?.type === "tool_result")) {
      const text = obj.content ?? obj.output ?? "";
      if (text) output.push(`[RESULT] ${typeof text === "string" ? text.slice(0, 80) : ""}`);
      continue;
    }

    // Result (final)
    if (obj.type === "result" && obj.result) {
      if (lastSection !== "assistant") { output.push("", "─── ASSISTANT ───"); lastSection = "assistant"; }
      output.push(...String(obj.result).split("\n"));
      continue;
    }

    // Claude Code assistant chunk format
    if (obj.type === "assistant" && obj.message?.content) {
      if (lastSection !== "assistant") { output.push("", "─── ASSISTANT ───"); lastSection = "assistant"; }
      for (const block of obj.message.content) {
        if (block.type === "text" && block.text) output.push(...block.text.split("\n"));
        if (block.type === "tool_use") output.push(`[TOOL] ${block.name ?? "tool"}`);
      }
      continue;
    }
  }

  if (output.length === 0) return rawLines;
  return output.slice(-MAX_BUFFER_LINES);
}

// ── TranscriptPane Component ──────────────────────────────────────────

import { parseMessages, type ChatMessage } from "./message-parser.js";
import { MessageList } from "./message-renderer.js";

export function TranscriptPane({ lines, scrollOffset, height, sessionId: _sessionId, role, backend, focused }: TranscriptPaneProps) {
  const visibleHeight = Math.max(height - 3, 5); // header(2) + scroll indicator(1)

  // Parse raw lines into structured messages for rich rendering
  const messages = React.useMemo(() => {
    // Only parse if lines look like ndjson
    const hasJson = lines.length > 0 && lines.some(l => l.trim().startsWith("{"));
    return hasJson ? parseMessages(lines) : null;
  }, [lines]);

  const scrollPct = lines.length > visibleHeight
    ? Math.round(((lines.length - scrollOffset - visibleHeight) / Math.max(1, lines.length - visibleHeight)) * 100)
    : 100;

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle={focused ? "bold" : "single"} borderColor={focused ? "cyan" : undefined} paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          {role ?? "agent"} <Text dimColor>{backend ?? ""}</Text>
        </Text>
        <Text dimColor>
          {scrollOffset > 0 ? `▲${scrollOffset}` : ""} {messages ? `${messages.length}msg` : `${lines.length}L`} {scrollPct}%
        </Text>
      </Box>
      <Text dimColor>{"─".repeat(40)}</Text>

      {/* Rich message rendering or plain text fallback */}
      <Box flexDirection="column" height={visibleHeight} overflowY="hidden">
        {messages ? (
          <MessageList
            messages={messages}
            visibleHeight={visibleHeight}
            scrollOffset={scrollOffset}
          />
        ) : lines.length === 0 ? (
          <Text dimColor>waiting for output...</Text>
        ) : (
          // Plain text fallback (non-ndjson content like commit details)
          (() => {
            const maxScroll = Math.max(0, lines.length - visibleHeight);
            const safeOffset = Math.min(scrollOffset, maxScroll);
            const startIdx = Math.max(0, lines.length - visibleHeight - safeOffset);
            return lines.slice(startIdx, startIdx + visibleHeight).map((line, i) => (
              <Text key={startIdx + i} wrap="truncate-end">{line}</Text>
            ));
          })()
        )}
      </Box>
    </Box>
  );
}
