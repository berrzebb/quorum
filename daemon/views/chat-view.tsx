import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";
import type { ProcessMux } from "../../platform/bus/mux.js";
import type { ParliamentLiveSession } from "../state-reader.js";

interface ChatViewProps {
  state: FullState | null;
  mux: ProcessMux | null;
  liveSessions?: ParliamentLiveSession[];
  width: number;
  height: number;
}

/**
 * Chat view — mux session transcript control + composer + git context.
 * Will delegate to session-list, transcript-pane, composer, git-sidebar in DUX-10.
 */
export function ChatView({ state: _state, mux, width, height: _height }: ChatViewProps): React.ReactElement {
  if (!mux) {
    return (
      <Box flexDirection="column">
        <Text bold>Chat</Text>
        <Text dimColor>No mux backend available.</Text>
      </Box>
    );
  }

  // For now, show session count — full chat will be built in DUX-10
  const sessions = mux.list();
  return (
    <Box flexDirection="column" width={width}>
      <Text bold>Chat</Text>
      <Text dimColor>Active sessions: {sessions.length}</Text>
      <Text dimColor>Use AgentChatPanel for full interaction (DUX-10 will refactor)</Text>
    </Box>
  );
}
