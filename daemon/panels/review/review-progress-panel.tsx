/**
 * ReviewProgressPanel — per-reviewer progress bars with phase indicator.
 *
 * Extracted from daemon/app.tsx inline panel.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ReviewProgressInfo } from "../../state-reader.js";
import { bar } from "../../lib/progress-bar.js";

interface ReviewProgressPanelProps {
  progress: ReviewProgressInfo[];
}

export function ReviewProgressPanel({ progress }: ReviewProgressPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={35}>
      <Text bold>Review Progress</Text>
      <Text dimColor>{"─".repeat(31)}</Text>
      {progress.map((r) => {
        const pct = Math.round(r.progress * 100);
        const barWidth = 16;
        return (
          <Box key={r.reviewerId} flexDirection="column">
            <Text>
              <Text bold>{r.reviewerId}</Text>
              {" "}
              <Text dimColor>{r.provider}</Text>
            </Text>
            <Box>
              <Text>{bar(r.progress, barWidth)}</Text>
              <Text dimColor> {pct}% </Text>
              <Text color="cyan">{r.phase}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
