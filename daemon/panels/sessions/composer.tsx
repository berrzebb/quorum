/**
 * Composer — input mode + buffer + submit for mux sessions.
 *
 * Extracted from AgentChatPanel.tsx (Bottom: input area).
 * Renders the input bar with mode-dependent display:
 * - Input mode: [>] {buffer}[cursor]
 * - Scroll mode: shortcut hints + session count
 */

import React from "react";
import { Box, Text } from "ink";

interface ComposerProps {
  buffer: string;
  mode: "idle" | "input";
  onSubmit: (text: string) => void;
  onBufferChange: (buffer: string) => void;
  sessionId: string;
  /** Number of active sessions (shown in idle mode). */
  sessionCount?: number;
}

export function Composer({ buffer, mode, onSubmit: _onSubmit, onBufferChange: _onBufferChange, sessionId: _sessionId, sessionCount }: ComposerProps) {
  return (
    <Box borderStyle="single" paddingX={1} height={3}>
      {mode === "input" ? (
        <Box flexGrow={1}>
          <Text color="cyan" bold>{">"} </Text>
          <Text>{buffer}<Text color="cyan" inverse> </Text></Text>
        </Box>
      ) : (
        <Box justifyContent="space-between" flexGrow={1}>
          <Text dimColor>
            [←→] session  [↑↓] scroll  [i] input  [Enter] send
          </Text>
          <Text dimColor>
            {sessionCount ?? 0} active
          </Text>
        </Box>
      )}
    </Box>
  );
}
