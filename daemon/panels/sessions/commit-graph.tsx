/**
 * CommitGraph — commit list with scroll support.
 *
 * Extracted from AgentChatPanel.tsx git log rendering.
 * Renders git log --oneline entries with WIP highlighting.
 * Graph decoration deferred to DUX-12.
 */

import React from "react";
import { Box, Text } from "ink";

interface CommitGraphProps {
  commits: string[];
  scrollOffset: number;
  height: number;
}

export function CommitGraph({ commits, scrollOffset, height }: CommitGraphProps) {
  const visibleHeight = Math.max(height, 3);
  const maxScroll = Math.max(0, commits.length - visibleHeight);
  const safeOffset = Math.min(scrollOffset, maxScroll);
  const displayCommits = commits.slice(safeOffset, safeOffset + visibleHeight);

  if (commits.length === 0) {
    return <Text dimColor>no commits</Text>;
  }

  return (
    <Box flexDirection="column">
      {displayCommits.map((line, i) => {
        const isWIP = line.includes("WIP(");
        return (
          <Text key={safeOffset + i} wrap="truncate-end" color={isWIP ? "green" : undefined} dimColor={!isWIP}>
            {line}
          </Text>
        );
      })}
      {maxScroll > 0 && safeOffset < maxScroll && (
        <Text dimColor>▼ {commits.length - safeOffset - visibleHeight} more</Text>
      )}
    </Box>
  );
}
