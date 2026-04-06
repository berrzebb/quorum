/**
 * GitExplorer — interactive git log + changed files + commit detail.
 *
 * Layout:
 *   ┌─Git Log────────────────┬─Changed Files─────────────────┐
 *   │ > abc1234 WIP(wave-1)  │ M src/app.ts                  │
 *   │   def5678 WIP(wave-2)  │ A src/routes/task.ts          │
 *   └────────────────────────┴───────────────────────────────┘
 *
 * When focused: ↑↓ navigates commit list, selected commit shows its files.
 * Returns commitDetail lines for parent to show in transcript area.
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { execFile } from "node:child_process";

interface GitExplorerProps {
  focused?: boolean;
  height: number;
  /** Called when selected commit changes — parent shows detail in transcript. */
  onCommitSelect?: (detail: string[]) => void;
  /** Called when ↑↓ changes selection. */
  selectedIdx: number;
  onSelectedIdxChange: (idx: number) => void;
}

interface CommitEntry {
  hash: string;
  message: string;
}

interface ChangedFile {
  file: string;
  status: string;
}

export function GitExplorer({ focused, height, onCommitSelect, selectedIdx, onSelectedIdxChange }: GitExplorerProps) {
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const lastGitRef = useRef("");

  // Poll git log
  useEffect(() => {
    const poll = () => {
      execFile("git", ["log", "--oneline", "-30"], {
        encoding: "utf8", timeout: 3000, windowsHide: true,
      }, (err, stdout) => {
        if (err) { setCommits([]); return; }
        const trimmed = stdout.trim();
        if (trimmed === lastGitRef.current) return;
        lastGitRef.current = trimmed;
        const entries = trimmed.split("\n").filter(Boolean).map(line => {
          const spaceIdx = line.indexOf(" ");
          return {
            hash: line.slice(0, spaceIdx),
            message: line.slice(spaceIdx + 1),
          };
        });
        setCommits(entries);
      });
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, []);

  // Fetch changed files + detail for selected commit
  useEffect(() => {
    if (commits.length === 0) return;
    const safeIdx = Math.min(selectedIdx, commits.length - 1);
    const commit = commits[safeIdx];
    if (!commit) return;

    // Changed files for this commit
    execFile("git", ["diff-tree", "--no-commit-id", "--name-status", "-r", commit.hash], {
      encoding: "utf8", timeout: 3000, windowsHide: true,
    }, (err, stdout) => {
      if (err) { setChangedFiles([]); return; }
      const files = stdout.trim().split("\n").filter(Boolean).map(line => {
        const [status, ...rest] = line.split("\t");
        return { file: rest.join("\t"), status: status ?? "M" };
      });
      setChangedFiles(files);
    });

    // Commit detail (diff --stat + message)
    execFile("git", ["show", "--stat", "--format=%B", commit.hash], {
      encoding: "utf8", timeout: 5000, windowsHide: true,
    }, (err, stdout) => {
      if (err) return;
      onCommitSelect?.(stdout.trim().split("\n"));
    });
  }, [selectedIdx, commits.length]);

  const visibleLines = Math.max(height - 3, 2);
  const safeIdx = Math.min(selectedIdx, Math.max(0, commits.length - 1));
  // Scroll window
  const scrollStart = Math.max(0, safeIdx - Math.floor(visibleLines / 2));
  const visibleCommits = commits.slice(scrollStart, scrollStart + visibleLines);
  const visibleFiles = changedFiles.slice(0, visibleLines);
  const borderStyle = focused ? "bold" as const : "single" as const;
  const borderColor = focused ? "cyan" : undefined;

  return (
    <Box flexDirection="row">
      {/* Git Log */}
      <Box flexDirection="column" flexGrow={1} borderStyle={borderStyle} borderColor={borderColor} paddingX={1} height={height}>
        <Text bold>Git Log {focused ? <Text color="cyan">(↑↓)</Text> : ""}</Text>
        <Text dimColor>{"─".repeat(30)}</Text>
        {visibleCommits.length === 0 ? (
          <Text dimColor>(no commits)</Text>
        ) : (
          visibleCommits.map((c, i) => {
            const actualIdx = scrollStart + i;
            const isSel = actualIdx === safeIdx;
            return (
              <Text key={c.hash} color={isSel && focused ? "cyan" : undefined} bold={isSel} wrap="truncate">
                {isSel ? ">" : " "} <Text color="yellow">{c.hash.slice(0, 7)}</Text> {c.message}
              </Text>
            );
          })
        )}
      </Box>

      {/* Changed Files */}
      <Box flexDirection="column" flexGrow={1} borderStyle={borderStyle} borderColor={borderColor} paddingX={1} height={height}>
        <Text bold>Changed Files</Text>
        <Text dimColor>{"─".repeat(30)}</Text>
        {visibleFiles.length === 0 ? (
          <Text dimColor>(select a commit)</Text>
        ) : (
          visibleFiles.map((cf, i) => (
            <Text key={i} wrap="truncate">
              <Text color={cf.status === "A" ? "green" : cf.status === "D" ? "red" : "yellow"}>{cf.status}</Text>
              {" "}{cf.file}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
