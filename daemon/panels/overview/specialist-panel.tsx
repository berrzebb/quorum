/**
 * SpecialistPanel — active specialist summary with tool/agent status.
 *
 * Extracted from daemon/app.tsx inline panel (Row 2).
 */

import React from "react";
import { Box, Text } from "ink";
import type { SpecialistInfo } from "../../state-reader.js";

interface SpecialistPanelProps {
  specialists: SpecialistInfo[];
}

export function SpecialistPanel({ specialists }: SpecialistPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={35}>
      <Text bold>Specialists</Text>
      {specialists.slice(0, 5).map((s) => (
        <Text key={s.domain}>
          <Text color="cyan">{s.domain}</Text>
          {s.tool && (
            <Text>
              {" "}
              <Text color={s.toolStatus === "pass" ? "green" : s.toolStatus === "fail" ? "red" : "yellow"}>
                {s.tool}:{s.toolStatus}
              </Text>
            </Text>
          )}
          {s.agent && (
            <Text dimColor> {s.agent}</Text>
          )}
        </Text>
      ))}
    </Box>
  );
}
