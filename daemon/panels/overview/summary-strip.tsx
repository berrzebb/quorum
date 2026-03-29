/**
 * SummaryStrip — one-line status summary (gate status + item counts).
 *
 * Compact overview row for the top of the dashboard.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ItemStateInfo } from "../../state-reader.js";

interface SummaryStripProps {
  items: ItemStateInfo[];
  lockCount: number;
  specialistCount: number;
}

export function SummaryStrip({ items, lockCount, specialistCount }: SummaryStripProps) {
  let approved = 0, rejected = 0;
  for (const i of items) {
    if (i.currentState === "approved") approved++;
    else if (i.currentState === "changes_requested") rejected++;
  }
  const pending = items.length - approved - rejected;

  return (
    <Box gap={2}>
      <Text>
        <Text bold>Items:</Text>{" "}
        <Text color="green">{approved} ok</Text>{" "}
        <Text color="yellow">{pending} pending</Text>{" "}
        <Text color="red">{rejected} rejected</Text>
      </Text>
      {lockCount > 0 && (
        <Text>
          <Text color="red">{lockCount} lock{lockCount !== 1 ? "s" : ""}</Text>
        </Text>
      )}
      {specialistCount > 0 && (
        <Text>
          <Text color="cyan">{specialistCount} specialist{specialistCount !== 1 ? "s" : ""}</Text>
        </Text>
      )}
    </Box>
  );
}
