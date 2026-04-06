/**
 * Overview view — system status at a glance.
 *
 * Layout:
 *   Row 1: GateStatus + AuditStream
 *   Row 2: ParliamentPanel (if sessions)
 *   Row 3: TrackProgress (if tracks)
 */

import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";
import type { QuorumEvent } from "../../platform/bus/events.js";
import { FocusBox } from "../components/FocusBox.js";
import { GateStatus } from "../components/GateStatus.js";
import { ParliamentPanel } from "../components/ParliamentPanel.js";
import { TrackProgress } from "../components/TrackProgress.js";
import { AuditStream } from "../components/AuditStream.js";

interface OverviewViewProps {
  state: FullState | null;
  events: QuorumEvent[];
  focusedRegion?: string | null;
  width: number;
  height: number;
}

export function OverviewView({ state, events, focusedRegion, width: _width, height: _height }: OverviewViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading overview...</Text></Box>;
  }

  const f = (region: string) => focusedRegion === region;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <FocusBox focused={f("overview.gates")}>
          <GateStatus events={events} />
        </FocusBox>
        <FocusBox focused={f("overview.tracks")}>
          <AuditStream events={events} />
        </FocusBox>
      </Box>

      {state.parliament.sessionCount > 0 && (
        <ParliamentPanel parliament={state.parliament} />
      )}

      {state.tracks.length > 0 && (
        <TrackProgress tracks={state.tracks} />
      )}
    </Box>
  );
}
