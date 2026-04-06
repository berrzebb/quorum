/**
 * Message Renderer — renders ChatMessage objects in Claude Code style.
 *
 * Inspired by Claude Code's Message.tsx → AssistantMessageBlock → AssistantToolUseMessage / AssistantTextMessage.
 * Adapted for quorum daemon's Ink 6 (no fork) environment.
 *
 * Layout per message type:
 *   user:        ❯ user input text
 *   assistant:   ● assistant response (markdown-ish)
 *   thinking:    ◐ thinking... (dimmed, collapsible)
 *   tool_use:    ⚡ ToolName  path/file.ts
 *   tool_result: │ output lines (dimmed, truncated)
 *   system:      ⚠ error/system message
 */

import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "./message-parser.js";

interface MessageListProps {
  messages: ChatMessage[];
  /** Number of visible lines (for virtual scroll). */
  visibleHeight?: number;
  /** Scroll offset from bottom. */
  scrollOffset?: number;
  /** Whether to collapse thinking blocks. */
  collapseThinking?: boolean;
}

// ── Tool icons (match Claude Code's visual style) ──

const TOOL_ICONS: Record<string, string> = {
  Read: "📖",
  Edit: "✏️",
  Write: "📝",
  Bash: "⚡",
  Grep: "🔍",
  Glob: "📂",
  Agent: "🤖",
  WebSearch: "🌐",
  WebFetch: "🌐",
};

function toolIcon(name: string): string {
  return TOOL_ICONS[name] ?? "⚙️";
}

function toolColor(name: string): string {
  switch (name) {
    case "Read": case "Glob": case "Grep": return "blue";
    case "Edit": case "Write": return "yellow";
    case "Bash": return "green";
    case "Agent": return "magenta";
    default: return "cyan";
  }
}

// ── Individual message renderers ──

const UserMessage = React.memo(function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text color="green" bold>{"❯"} </Text>
        <Text>{msg.lines.join("\n")}</Text>
      </Box>
    </Box>
  );
});

const AssistantMessage = React.memo(function AssistantMessage({ msg }: { msg: ChatMessage }) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Box flexDirection="row">
        <Box minWidth={2}>
          <Text color="white">{"●"}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {msg.lines.map((line, i) => (
            <Text key={i} wrap="wrap">{line}</Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
});

const ThinkingMessage = React.memo(function ThinkingMessage({ msg, collapsed }: { msg: ChatMessage; collapsed: boolean }) {
  if (collapsed) {
    return (
      <Box marginTop={1}>
        <Text dimColor>{"◐"} thinking ({msg.lines.length} lines)</Text>
      </Box>
    );
  }
  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor bold>{"◐"} thinking</Text>
      <Box marginLeft={2} flexDirection="column">
        {msg.lines.slice(0, 20).map((line, i) => (
          <Text key={i} dimColor wrap="wrap">{line}</Text>
        ))}
        {msg.lines.length > 20 && (
          <Text dimColor>  ... ({msg.lines.length - 20} more lines)</Text>
        )}
      </Box>
    </Box>
  );
});

const ToolUseMessage = React.memo(function ToolUseMessage({ msg }: { msg: ChatMessage }) {
  const name = msg.toolName ?? "tool";
  const icon = toolIcon(name);
  const color = toolColor(name);

  return (
    <Box marginTop={1} flexDirection="column">
      <Box gap={1}>
        <Text>{icon}</Text>
        <Text color={color} bold>{name}</Text>
        {msg.filePath && <Text dimColor>{msg.filePath}</Text>}
      </Box>
      {msg.lines.length > 0 && (
        <Box marginLeft={3} flexDirection="column">
          {msg.lines.map((line, i) => (
            <Text key={i} dimColor wrap="truncate">{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
});

const ToolResultMessage = React.memo(function ToolResultMessage({ msg }: { msg: ChatMessage }) {
  if (msg.lines.length === 0) return null;

  return (
    <Box flexDirection="column" marginLeft={3}>
      {msg.lines.map((line, i) => (
        <Text key={i} dimColor wrap="truncate">{line}</Text>
      ))}
    </Box>
  );
});

const SystemMessage = React.memo(function SystemMessage({ msg }: { msg: ChatMessage }) {
  return (
    <Box marginTop={1}>
      <Text color="red">{"⚠"} {msg.lines.join("\n")}</Text>
    </Box>
  );
});

// ── Main renderer ──

export function MessageList({ messages, visibleHeight, scrollOffset = 0, collapseThinking = true }: MessageListProps) {
  // Virtual window: compute visible range
  const allElements = messages.map((msg, i) => {
    switch (msg.type) {
      case "user": return <UserMessage key={`u-${i}`} msg={msg} />;
      case "assistant": return <AssistantMessage key={`a-${i}`} msg={msg} />;
      case "thinking": return <ThinkingMessage key={`t-${i}`} msg={msg} collapsed={collapseThinking} />;
      case "tool_use": return <ToolUseMessage key={`tu-${i}`} msg={msg} />;
      case "tool_result": return <ToolResultMessage key={`tr-${i}`} msg={msg} />;
      case "system": return <SystemMessage key={`s-${i}`} msg={msg} />;
    }
  });

  if (visibleHeight && allElements.length > visibleHeight) {
    // Simple windowing: estimate ~2 lines per message, show last N
    const estimatedMsgCount = Math.ceil(visibleHeight / 2);
    const startIdx = Math.max(0, allElements.length - estimatedMsgCount - scrollOffset);
    const endIdx = startIdx + estimatedMsgCount;
    return <>{allElements.slice(startIdx, endIdx)}</>;
  }

  return <>{allElements}</>;
}
