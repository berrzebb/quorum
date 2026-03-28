/**
 * GitSidebar — container for git context (commit graph + changed files).
 *
 * Extracted from AgentChatPanel.tsx (Col 3: Git log).
 * Renders commit list and changed files in a vertical split.
 * Commit graph enrichment deferred to DUX-12.
 */

import React from "react";
import { Box, Text } from "ink";
import { CommitGraph } from "./commit-graph.js";
import { ChangedFiles, ChangedFileInfo } from "./changed-files.js";

interface GitSidebarProps {
  gitLog: string[];
  width: number;
  commitScrollOffset: number;
  filesScrollOffset: number;
  /** Changed files for the bottom section. */
  changedFiles?: ChangedFileInfo[];
}

export function GitSidebar({ gitLog, width, commitScrollOffset, filesScrollOffset, changedFiles }: GitSidebarProps) {
  // Split vertical space: commits get 70%, files get 30%
  // For now, if no changedFiles provided, commits take full height
  const hasFiles = changedFiles && changedFiles.length > 0;

  return (
    <Box flexDirection="column" width={width} borderStyle="single" paddingX={1}>
      <Text bold>Git Log</Text>
      <Text dimColor>{"─".repeat(Math.max(0, width - 4))}</Text>

      {/* Commit graph section */}
      <CommitGraph
        commits={gitLog}
        scrollOffset={commitScrollOffset}
        height={hasFiles ? Math.max(5, 20) : 30}
      />

      {/* Changed files section */}
      {hasFiles && (
        <>
          <Text dimColor>{"─".repeat(Math.max(0, width - 4))}</Text>
          <Text bold>Changed</Text>
          <ChangedFiles
            files={changedFiles}
            scrollOffset={filesScrollOffset}
            height={8}
          />
        </>
      )}
    </Box>
  );
}
