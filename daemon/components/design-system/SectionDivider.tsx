/**
 * SectionDivider — visual separator between panel sections.
 *
 * Density-aware: hidden in compact mode.
 */

import React from "react";
import { Box, Text } from "ink";
import type { DensityMode } from "../../shell/density.js";

export interface SectionDividerProps {
  /** Optional section label. */
  label?: string;
  /** Density mode (default: comfortable). */
  density?: DensityMode;
}

export function SectionDivider({
  label,
  density = "comfortable",
}: SectionDividerProps): React.ReactElement | null {
  if (density === "compact") return null;

  if (label) {
    return (
      <Box marginTop={1}>
        <Text dimColor>── {label} ──</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text dimColor>{"─".repeat(20)}</Text>
    </Box>
  );
}
