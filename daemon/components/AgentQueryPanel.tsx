/**
 * AgentQueryPanel — displays inter-agent communication in the daemon TUI.
 */

import React from "react";
import { Box, Text } from "ink";
import type { AgentQueryInfo } from "../state-reader.js";

interface Props {
  queries: AgentQueryInfo[];
}

export function AgentQueryPanel({ queries }: Props) {
  if (queries.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={50}>
      <Text bold>Agent Queries</Text>
      <Text dimColor>{"─".repeat(46)}</Text>
      {queries.slice(0, 8).map((q) => {
        const age = Math.round((Date.now() - q.timestamp) / 1000);
        const target = q.toAgent ? ` → ${q.toAgent}` : " (broadcast)";
        const answered = q.responseCount > 0;
        return (
          <Box key={q.queryId} flexDirection="column">
            <Text>
              <Text color={answered ? "green" : "yellow"}>{answered ? "✓" : "○"}</Text>
              {" "}
              <Text bold>{q.fromAgent}</Text>
              <Text dimColor>{target}</Text>
              <Text dimColor> {age}s</Text>
              {q.responseCount > 0 && <Text color="green"> ({q.responseCount})</Text>}
            </Text>
            <Text dimColor wrap="truncate-end">  {q.question.length > 44 ? q.question.slice(0, 41) + "..." : q.question}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
