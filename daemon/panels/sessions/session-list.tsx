/**
 * SessionList — session list rendering with role color coding.
 *
 * Extracted from AgentChatPanel.tsx (Col 1: Session list).
 * Renders active mux sessions with selection indicator and role colors.
 */

import React from "react";
import { Box, Text } from "ink";

export interface SessionInfo {
  id: string;
  name: string;
  backend: string;
  startedAt: number;
  role?: string;
}

interface SessionListProps {
  sessions: SessionInfo[];
  selectedIdx: number;
  onSelect: (idx: number) => void;
  width?: number;
}

/** Map role name to terminal color. */
function roleColor(role: string): string {
  switch (role) {
    case "advocate": return "green";
    case "devil": return "red";
    case "judge": return "blue";
    case "implementer":
    case "impl": return "yellow";
    default: return "white";
  }
}

/** Format age as human-readable (e.g. "42s", "3m"). */
function formatAge(startedAt: number): string {
  const age = Math.round((Date.now() - startedAt) / 1000);
  return age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
}

export function SessionList({ sessions, selectedIdx, onSelect: _onSelect, width = 22 }: SessionListProps) {
  return (
    <Box flexDirection="column" width={width} borderStyle="single" paddingX={1}>
      <Text bold>Sessions</Text>
      <Text dimColor>{"─".repeat(Math.max(0, width - 4))}</Text>
      {sessions.map((s, i) => {
        const isSel = i === selectedIdx;
        const role = s.role ?? s.name.split("-").slice(-2, -1)[0] ?? "agent";
        const color = roleColor(role);
        return (
          <Text key={s.id} color={isSel ? "cyan" : undefined} bold={isSel}>
            {isSel ? ">" : " "} <Text color={color}>{role.slice(0, 10).padEnd(10)}</Text>
            <Text dimColor>{formatAge(s.startedAt)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
