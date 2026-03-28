/**
 * ChangedFiles — changed file list with status indicators.
 *
 * Renders git changed files with status color coding:
 * - M (modified) = yellow
 * - A (added) = green
 * - D (deleted) = red
 * - R (renamed) = blue
 * - ? (untracked) = dim
 */

import React from "react";
import { Box, Text } from "ink";

export interface ChangedFileInfo {
  path: string;
  status: string;
}

interface ChangedFilesProps {
  files: ChangedFileInfo[];
  scrollOffset: number;
  height: number;
}

/** Map git status to terminal color. */
function statusColor(status: string): string {
  switch (status.charAt(0).toUpperCase()) {
    case "M": return "yellow";
    case "A": return "green";
    case "D": return "red";
    case "R": return "blue";
    case "?": return "gray";
    default: return "white";
  }
}

export function ChangedFiles({ files, scrollOffset, height }: ChangedFilesProps) {
  const visibleHeight = Math.max(height, 3);
  const maxScroll = Math.max(0, files.length - visibleHeight);
  const safeOffset = Math.min(scrollOffset, maxScroll);
  const displayFiles = files.slice(safeOffset, safeOffset + visibleHeight);

  if (files.length === 0) {
    return <Text dimColor>no changes</Text>;
  }

  return (
    <Box flexDirection="column">
      {displayFiles.map((file, i) => (
        <Text key={safeOffset + i} wrap="truncate-end">
          <Text color={statusColor(file.status)}>{file.status.padEnd(2)}</Text>
          {" "}{file.path}
        </Text>
      ))}
      {maxScroll > 0 && safeOffset < maxScroll && (
        <Text dimColor>▼ {files.length - safeOffset - visibleHeight} more</Text>
      )}
    </Box>
  );
}
