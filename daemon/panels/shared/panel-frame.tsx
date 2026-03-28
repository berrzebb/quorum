/**
 * PanelFrame — reusable panel wrapper with border and title.
 *
 * Standardizes the visual structure shared by all dashboard panels:
 * border, title, optional separator, content area.
 */

import React from "react";
import { Box, Text } from "ink";

interface PanelFrameProps {
  title: string;
  width?: number | string;
  height?: number;
  children: React.ReactNode;
}

export function PanelFrame({ title, width, height, children }: PanelFrameProps) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={width} height={height}>
      <Text bold>{title}</Text>
      {children}
    </Box>
  );
}
