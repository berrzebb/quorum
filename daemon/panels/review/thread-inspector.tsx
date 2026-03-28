/**
 * ThreadInspector — shows messages for a selected thread in a file.
 *
 * Enables finding list → thread/file drill-down (DUX-13).
 */

import React from "react";
import { Box, Text } from "ink";

/**
 * Thread message for display.
 */
export interface ThreadDisplayMessage {
  type: "finding" | "reply" | "ack" | "resolve";
  reviewerId?: string;
  provider?: string;
  description: string;
  severity?: string;
  timestamp: number;
}

/**
 * Thread for display.
 */
export interface DisplayThread {
  rootId: string;
  category: string;
  messages: ThreadDisplayMessage[];
  open: boolean;
}

/**
 * Thread inspector props.
 */
interface ThreadInspectorProps {
  file: string;
  threads: DisplayThread[];
  selectedThreadIdx: number;
  height: number;
}

/**
 * Returns color for a message type.
 */
export function messageColor(type: string): string {
  switch (type) {
    case "finding": return "red";
    case "reply": return "cyan";
    case "ack": return "yellow";
    case "resolve": return "green";
    default: return "white";
  }
}

/**
 * Thread inspector — shows messages for a selected thread in a file.
 */
export function ThreadInspector({ file, threads, selectedThreadIdx, height }: ThreadInspectorProps): React.ReactElement {
  if (threads.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Thread Inspector</Text>
        <Text dimColor>No threads for {file}</Text>
      </Box>
    );
  }

  const thread = threads[Math.min(selectedThreadIdx, threads.length - 1)];

  return (
    <Box flexDirection="column" height={height}>
      <Text bold>Thread: {thread.category} ({thread.open ? "open" : "closed"})</Text>
      <Text dimColor>{file} — {thread.messages.length} messages</Text>
      {thread.messages.slice(0, height - 2).map((msg, i) => (
        <Box key={i}>
          <Text color={messageColor(msg.type)}>
            [{msg.type}] {msg.description}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
