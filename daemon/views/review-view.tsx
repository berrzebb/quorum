import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";

interface ReviewViewProps {
  state: FullState | null;
  width: number;
  height: number;
}

/**
 * Review view — findings, threads, and review progress drill-down.
 * Absorbs the old "log" view's audit stream functionality.
 */
export function ReviewView({ state, width, height: _height }: ReviewViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading review...</Text></Box>;
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text bold>Review</Text>
      <Text dimColor>Findings: {state.findingStats.total} total, {state.findingStats.open} open</Text>
      <Text dimColor>Review progress: {state.reviewProgress.length} reviewers</Text>
      <Text dimColor>File threads: {state.fileThreads.length} files</Text>
      <Text dimColor>Recent events: {state.recentEvents.length}</Text>
    </Box>
  );
}
