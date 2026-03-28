import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";

interface OperationsViewProps {
  state: FullState | null;
  width: number;
  height: number;
}

/**
 * Operations view — provider, lock, worktree, diagnostics.
 * New view (no equivalent in old 3-view structure).
 */
export function OperationsView({ state, width, height: _height }: OperationsViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading operations...</Text></Box>;
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>Operations</Text>
      <Text dimColor>Active locks: {state.locks.length}</Text>
      <Text dimColor>Specialists: {state.specialists.length}</Text>
      <Text dimColor>Agent queries: {state.agentQueries.length}</Text>
    </Box>
  );
}
