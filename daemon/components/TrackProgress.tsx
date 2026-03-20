/**
 * Track Progress — work breakdown execution status with gate enforcement visibility.
 */

import React from "react";
import { Box, Text } from "ink";
import type { QuorumEvent } from "../../bus/events.js";

interface TrackProgressProps {
  events: QuorumEvent[];
}

interface Track {
  id: string;
  total: number;
  completed: number;
  pending: number;
  blocked: number;
  lastUpdate: number;
}

export function TrackProgress({ events }: TrackProgressProps) {
  const tracks = deriveTracks(events);

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={35}>
      <Text bold>Tracks</Text>
      <Text dimColor>{"─".repeat(31)}</Text>

      {tracks.length === 0 ? (
        <Text dimColor>No active tracks</Text>
      ) : (
        tracks.map((track) => {
          const pct = track.total > 0 ? Math.round((track.completed / track.total) * 100) : 0;
          const barWidth = 20;
          const filled = Math.round((pct / 100) * barWidth);

          return (
            <Box key={track.id} flexDirection="column">
              <Box gap={1}>
                <Text bold>{track.id}</Text>
                <Text dimColor>{pct}%</Text>
                {track.blocked > 0 && (
                  <Text color="red">[{track.blocked} blocked]</Text>
                )}
              </Box>
              <Box>
                <Text color="green">{"█".repeat(filled)}</Text>
                <Text dimColor>{"░".repeat(barWidth - filled)}</Text>
                <Text dimColor> {track.completed}/{track.total}</Text>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}

function deriveTracks(events: QuorumEvent[]): Track[] {
  const tracks = new Map<string, Track>();

  for (const event of events) {
    const trackId = event.trackId ?? (event.payload.trackId as string | undefined);
    if (!trackId) continue;

    if (event.type === "track.create" || event.type === "track.progress") {
      const payload = event.payload;
      tracks.set(trackId, {
        id: trackId,
        total: (payload.total as number) ?? 0,
        completed: (payload.completed as number) ?? 0,
        pending: (payload.pending as number) ?? 0,
        blocked: (payload.blocked as number) ?? 0,
        lastUpdate: event.timestamp,
      });
    }
  }

  return [...tracks.values()].sort((a, b) => b.lastUpdate - a.lastUpdate);
}
