/**
 * Review view — findings, threads, and review progress drill-down.
 *
 * Absorbs the old "log" view's audit stream functionality.
 * Layout:
 *   Row 1: FindingStatsPanel + OpenFindingsPanel + ReviewProgressPanel (if progress exists)
 *   Row 2: AuditStream (fullScreen mode)
 */

import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";
import type { QuorumEvent } from "../../platform/bus/events.js";
import { AuditStream } from "../components/AuditStream.js";
import { FindingStatsPanel } from "../panels/review/finding-stats-panel.js";
import { OpenFindingsPanel } from "../panels/review/open-findings-panel.js";
import { ReviewProgressPanel } from "../panels/review/review-progress-panel.js";

interface ReviewViewProps {
  state: FullState | null;
  events: QuorumEvent[];
  width: number;
  height: number;
}

export function ReviewView({ state, events, width: _width, height: _height }: ReviewViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading review...</Text></Box>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {/* Row 1: finding stats + open findings + review progress */}
      <Box gap={2}>
        <FindingStatsPanel stats={state.findingStats} />
        <OpenFindingsPanel findings={state.findings} />
        {state.reviewProgress.length > 0 && (
          <ReviewProgressPanel progress={state.reviewProgress} />
        )}
      </Box>

      {/* Row 2: full audit stream */}
      <AuditStream events={events} fullScreen />
    </Box>
  );
}
