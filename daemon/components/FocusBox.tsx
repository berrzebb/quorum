/**
 * FocusBox — wraps any panel with a focus indicator.
 * When focused, adds a cyan left-border indicator.
 * Does NOT add its own border (child components keep their own borders).
 */

import React from "react";
import { Box, Text } from "ink";

interface FocusBoxProps {
  focused?: boolean;
  children: React.ReactNode;
}

export function FocusBox({ focused, children }: FocusBoxProps) {
  return (
    <Box>
      <Text color={focused ? "cyan" : undefined}>{focused ? "▐" : " "}</Text>
      {children}
    </Box>
  );
}
