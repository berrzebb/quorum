/**
 * Panel — shared container primitive for daemon TUI panels.
 *
 * Adopted from Claude Code ThemedBox pattern.
 * Replaces repeated Box+border+title+separator in every panel component.
 *
 * Density-aware: respects comfortable/compact modes from density.ts.
 */

import React from "react";
import { Box, Text } from "ink";
import type { DensityMode } from "../../shell/density.js";
import { getDensityConfig } from "../../shell/density.js";

export interface PanelProps {
  /** Panel title (rendered bold). */
  title: string;
  /** Width in characters. */
  width?: number;
  /** Whether to fill available height. */
  flexGrow?: number;
  /** Density mode (default: comfortable). */
  density?: DensityMode;
  /** Optional right-aligned status text in header. */
  headerRight?: React.ReactNode;
  /** Child content. */
  children: React.ReactNode;
}

export function Panel({
  title,
  width,
  flexGrow,
  density = "comfortable",
  headerRight,
  children,
}: PanelProps): React.ReactElement {
  const config = getDensityConfig(density);
  const separatorWidth = (width ?? 30) - (config.panelPadding * 2) - 2;

  return (
    <Box
      flexDirection="column"
      borderStyle={config.showBorders ? "single" : undefined}
      paddingX={config.panelPadding}
      width={width}
      flexGrow={flexGrow}
    >
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        {headerRight}
      </Box>
      {config.showBorders && (
        <Text dimColor>{"─".repeat(Math.max(0, separatorWidth))}</Text>
      )}
      {children}
    </Box>
  );
}
