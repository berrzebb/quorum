/**
 * OpenFindingsPanel — top 8 open findings sorted by severity.
 *
 * Extracted from daemon/app.tsx inline panel.
 */

import React from "react";
import { Box, Text } from "ink";
import type { FindingInfo } from "../../state-reader.js";
import { severityColor } from "../../lib/format.js";

interface OpenFindingsPanelProps {
  findings: FindingInfo[];
}

export function OpenFindingsPanel({ findings }: OpenFindingsPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={60}>
      <Text bold>Open Findings</Text>
      <Text dimColor>{"─".repeat(56)}</Text>
      {findings.length === 0 ? (
        <Text dimColor>No open findings</Text>
      ) : (
        findings.slice(0, 8).map((f) => {
          const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
          const desc = f.description.length > 30
            ? f.description.slice(0, 30) + "..."
            : f.description;
          return (
            <Text key={f.id}>
              <Text dimColor>{f.id} </Text>
              <Text color={severityColor(f.severity)} bold={f.severity === "critical"}>
                {f.severity.padEnd(8)}
              </Text>
              {" "}
              {loc && <Text color="cyan">{loc} </Text>}
              <Text>{desc}</Text>
            </Text>
          );
        })
      )}
      {findings.length > 8 && (
        <Text dimColor>...and {findings.length - 8} more</Text>
      )}
    </Box>
  );
}
