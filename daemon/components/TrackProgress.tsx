/**
 * Track Progress — work breakdown execution status.
 *
 * Uses TrackInfo[] from StateReader (SQLite polling) instead of bus EventEmitter
 * so that external CLI events are visible.
 */

import React from "react";
import { Box, Text } from "ink";
import type { TrackInfo } from "../state-reader.js";

interface TrackProgressProps {
  tracks: TrackInfo[];
}

export function TrackProgress({ tracks }: TrackProgressProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={35}>
      <Text bold>Tracks</Text>
      <Text dimColor>{"─".repeat(31)}</Text>

      {tracks.length === 0 ? (
        <Text dimColor>No active tracks</Text>
      ) : (
        tracks.map((track) => {
          // Guard: if completed > total (stale events), use completed as total
          const displayTotal = Math.max(track.total, track.completed);
          const pct = displayTotal > 0 ? Math.min(100, Math.round((track.completed / displayTotal) * 100)) : 0;
          const barWidth = 20;
          const filled = Math.max(0, Math.min(barWidth, Math.round((pct / 100) * barWidth)));

          return (
            <Box key={track.trackId} flexDirection="column">
              <Box gap={1}>
                <Text bold>{track.trackId}</Text>
                <Text dimColor>{pct}%</Text>
                {track.blocked > 0 && (
                  <Text color="red">[{track.blocked} blocked]</Text>
                )}
              </Box>
              <Box>
                <Text color="green">{"█".repeat(filled)}</Text>
                <Text dimColor>{"░".repeat(barWidth - filled)}</Text>
                <Text dimColor> {track.completed}/{displayTotal}</Text>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
