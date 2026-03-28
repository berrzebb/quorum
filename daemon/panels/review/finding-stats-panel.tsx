/**
 * FindingStatsPanel — total/open/confirmed/fixed/dismissed finding counts.
 *
 * Extracted from daemon/app.tsx inline panel.
 */

import React from "react";
import { Box, Text } from "ink";
import type { FindingStats } from "../../state-reader.js";

interface FindingStatsPanelProps {
  stats: FindingStats;
}

export function FindingStatsPanel({ stats }: FindingStatsPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={24}>
      <Text bold>Finding Stats</Text>
      <Text dimColor>{"─".repeat(20)}</Text>
      <Text>Total:     <Text bold>{stats.total}</Text></Text>
      <Text>Open:      <Text color="red" bold>{stats.open}</Text></Text>
      <Text>Confirmed: <Text color="yellow">{stats.confirmed}</Text></Text>
      <Text>Fixed:     <Text color="green">{stats.fixed}</Text></Text>
      <Text>Dismissed: <Text dimColor>{stats.dismissed}</Text></Text>
    </Box>
  );
}
