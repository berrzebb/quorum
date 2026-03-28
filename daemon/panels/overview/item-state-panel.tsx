/**
 * ItemStatePanel — item state list with color-coded status.
 *
 * Extracted from daemon/app.tsx inline panel (Row 1).
 */

import React from "react";
import { Box, Text } from "ink";
import type { ItemStateInfo } from "../../state-reader.js";

interface ItemStatePanelProps {
  items: ItemStateInfo[];
}

export function ItemStatePanel({ items }: ItemStatePanelProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={40}>
      <Text bold>Item States</Text>
      {items.slice(0, 6).map((item) => (
        <Text key={item.entityId}>
          <Text color={
            item.currentState === "approved" ? "green"
            : item.currentState === "changes_requested" ? "red"
            : "yellow"
          }>
            {item.entityId}
          </Text>
          {" "}
          <Text dimColor>[{item.currentState}]</Text>
          {" "}
          <Text dimColor>{item.source}</Text>
        </Text>
      ))}
    </Box>
  );
}
