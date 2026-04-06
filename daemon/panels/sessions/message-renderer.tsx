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

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "./message-parser.js";
import { renderMarkdown } from "./markdown-render.js";

interface MessageListProps {
  messages: ChatMessage[];
  /** Number of visible lines (for virtual scroll). */
  visibleHeight?: number;
  /** Scroll offset from bottom. */
  scrollOffset?: number;
  /** Whether to collapse thinking blocks. */
  collapseThinking?: boolean;
  /** Set of tool_use IDs currently in progress (for loader animation). */
  inProgressIds?: Set<string>;
}

// ── useBlink hook (Claude Code style) ──

function useBlink(interval = 500): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => setOn(v => !v), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return on;
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
  const rendered = renderMarkdown(msg.lines.join("\n"));
  const renderedLines = rendered ? rendered.split("\n") : msg.lines;

  return (
    <Box marginTop={1} flexDirection="column">
      <Box flexDirection="row">
        <Box minWidth={2}>
          <Text color="white">{"●"}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {renderedLines.map((line, i) => (
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

const ToolUseMessage = React.memo(function ToolUseMessage({ msg, inProgress }: { msg: ChatMessage; inProgress?: boolean }) {
  const name = msg.toolName ?? "tool";
  const icon = toolIcon(name);
  const color = toolColor(name);
  const blink = useBlink(400);

  // Determine status: in-progress, completed, or unknown
  const isActive = inProgress ?? false;
  const dot = isActive ? (blink ? "●" : " ") : "✓";
  const dotColor = isActive ? "cyan" : "green";

  return (
    <Box marginTop={1} flexDirection="column">
      <Box gap={1}>
        <Text color={dotColor}>{dot}</Text>
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

const CollapsedGroupMessage = React.memo(function CollapsedGroupMessage({ msg }: { msg: ChatMessage }) {
  const count = msg.groupCount ?? 0;
  const items = msg.groupedItems ?? [];
  // Show up to 3 file paths
  const paths = items.filter(i => i.filePath).slice(0, 3).map(i => i.filePath!);
  const remaining = count - paths.length;

  return (
    <Box marginTop={1} flexDirection="column">
      <Box gap={1}>
        <Text dimColor>{"📚"}</Text>
        <Text dimColor bold>{msg.lines[0]}</Text>
      </Box>
      {paths.length > 0 && (
        <Box marginLeft={3} flexDirection="column">
          {paths.map((p, i) => (
            <Text key={i} dimColor>  {p}</Text>
          ))}
          {remaining > 0 && <Text dimColor>  ... +{remaining} more</Text>}
        </Box>
      )}
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

export function MessageList({ messages, visibleHeight, scrollOffset = 0, collapseThinking = true, inProgressIds }: MessageListProps) {
  // Virtual window: compute visible range
  const allElements = messages.map((msg, i) => {
    switch (msg.type) {
      case "user": return <UserMessage key={`u-${i}`} msg={msg} />;
      case "assistant": return <AssistantMessage key={`a-${i}`} msg={msg} />;
      case "thinking": return <ThinkingMessage key={`t-${i}`} msg={msg} collapsed={collapseThinking} />;
      case "tool_use": return <ToolUseMessage key={`tu-${i}`} msg={msg} inProgress={msg.toolUseId ? inProgressIds?.has(msg.toolUseId) : undefined} />;
      case "tool_result": return <ToolResultMessage key={`tr-${i}`} msg={msg} />;
      case "collapsed_group": return <CollapsedGroupMessage key={`cg-${i}`} msg={msg} />;
      case "system": return <SystemMessage key={`s-${i}`} msg={msg} />;
    }
  });

  if (visibleHeight) {
    // Height-aware windowing: estimate each message's line count
    const heights = messages.map(msg => {
      switch (msg.type) {
        case "thinking": return collapseThinking ? 1 : Math.min(msg.lines.length + 1, 22);
        case "tool_result": return Math.min(msg.lines.length, 9);
        case "collapsed_group": return 2 + Math.min((msg.groupedItems?.filter(i => i.filePath).length ?? 0), 3);
        case "tool_use": return 1 + msg.lines.length;
        case "assistant": return msg.lines.length + 1; // +1 for margin
        default: return msg.lines.length + 1;
      }
    });

    // Find window: walk from end, accumulating heights
    const totalHeight = heights.reduce((a, b) => a + b, 0);
    if (totalHeight <= visibleHeight) return <>{allElements}</>;

    // scrollOffset = lines scrolled up from bottom
    let accumulated = 0;
    let endIdx = allElements.length;
    // Skip scrollOffset lines from bottom
    let skipped = 0;
    for (let i = allElements.length - 1; i >= 0 && skipped < scrollOffset; i--) {
      skipped += heights[i]!;
      endIdx = i;
    }
    // Accumulate from endIdx backwards to fill visible height
    let startIdx = endIdx;
    for (let i = endIdx - 1; i >= 0 && accumulated < visibleHeight; i--) {
      accumulated += heights[i]!;
      startIdx = i;
    }

    return <>{allElements.slice(startIdx, endIdx)}</>;
  }

  return <>{allElements}</>;
}
