/**
 * Review view — findings, threads, and review progress.
 *
 * Layout:
 *   Row 1: FindingStatsPanel + OpenFindingsPanel + ReviewProgressPanel
 *   Row 2: FileThreads (if any)
 */

import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";
import type { QuorumEvent } from "../../platform/bus/events.js";
import { FocusBox } from "../components/FocusBox.js";
import { FindingStatsPanel } from "../panels/review/finding-stats-panel.js";
import { OpenFindingsPanel } from "../panels/review/open-findings-panel.js";
import { ReviewProgressPanel } from "../panels/review/review-progress-panel.js";

interface ReviewViewProps {
  state: FullState | null;
  events: QuorumEvent[];
  focusedRegion?: string | null;
  width: number;
  height: number;
}

export function ReviewView({ state, events: _events, focusedRegion, width: _width, height: _height }: ReviewViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading review...</Text></Box>;
  }

  const f = (region: string) => focusedRegion === region;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <FocusBox focused={f("review.findings")}>
          <FindingStatsPanel stats={state.findingStats} />
        </FocusBox>
        <FocusBox focused={f("review.thread")}>
          <OpenFindingsPanel findings={state.findings} />
        </FocusBox>
        {state.reviewProgress.length > 0 && (
          <ReviewProgressPanel progress={state.reviewProgress} />
        )}
      </Box>

      {state.fileThreads.length > 0 && (
        <Box flexDirection="column" borderStyle="single" paddingX={1}>
          <Text bold>File Threads ({state.fileThreads.length})</Text>
          <Text dimColor>{"─".repeat(40)}</Text>
          {state.fileThreads.slice(0, 10).map((ft, i) => (
            <Box key={i} gap={1}>
              <Text color="cyan">{ft.file.split("/").pop()}</Text>
              <Text dimColor>{ft.threads.length} thread(s)</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
