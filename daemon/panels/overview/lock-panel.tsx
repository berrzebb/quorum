/**
 * LockPanel — active locks summary with owner and age.
 *
 * Extracted from daemon/app.tsx inline panel (Row 2).
 */

import React from "react";
import { Box, Text } from "ink";
import type { LockInfo } from "../../../platform/bus/lock.js";
import { ageSeconds } from "../../lib/time.js";

interface LockPanelProps {
  locks: LockInfo[];
}

export function LockPanel({ locks }: LockPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={30}>
      <Text bold>Active Locks</Text>
      {locks.map((lock) => {
        const age = Math.round(ageSeconds(lock.acquiredAt ?? 0) / 60);
        return (
          <Text key={lock.lockName}>
            <Text color="red">{lock.lockName}</Text>
            {" "}
            <Text dimColor>pid:{lock.owner} {age}m</Text>
          </Text>
        );
      })}
    </Box>
  );
}
