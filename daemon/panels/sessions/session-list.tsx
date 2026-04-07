/**
 * SessionList — session list rendering with role color coding.
 *
 * Extracted from AgentChatPanel.tsx (Col 1: Session list).
 * Renders active mux sessions with selection indicator and role colors.
 */

import React from "react";
import { Box, Text } from "ink";
import { ageSeconds } from "../../lib/time.js";

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
  height?: number;
  focused?: boolean;
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

function formatAge(startedAt: number): string {
  const age = ageSeconds(startedAt);
  return age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
}

export function SessionList({ sessions, selectedIdx, onSelect: _onSelect, width = 22, height, focused }: SessionListProps) {
  return (
    <Box flexDirection="column" width={width} height={height} borderStyle={focused ? "bold" : "single"} borderColor={focused ? "cyan" : undefined} paddingX={1} overflowY="hidden">
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
