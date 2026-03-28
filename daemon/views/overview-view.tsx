import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";

interface OverviewViewProps {
  state: FullState | null;
  width: number;
  height: number;
}

/**
 * Overview view — shows overall system status at a glance.
 * Replaces the old "dashboard" view with structured panel composition.
 */
export function OverviewView({ state, width, height: _height }: OverviewViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading overview...</Text></Box>;
  }

  // For now, delegate to existing dashboard panels
  // These will be extracted to daemon/panels/ in DUX-9
  return (
    <Box flexDirection="column" width={width}>
      <Text bold>Overview</Text>
      <Text dimColor>Gates: {state.gates.length} | Items: {state.items.length} | Tracks: {state.tracks.length}</Text>
      <Text dimColor>Findings: {state.findingStats.total} (open: {state.findingStats.open})</Text>
      <Text dimColor>Fitness: {state.fitness.current?.toFixed(2) ?? "N/A"}</Text>
      <Text dimColor>Parliament sessions: {state.parliament.sessionCount}</Text>
    </Box>
  );
}
