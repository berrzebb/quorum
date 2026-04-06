/**
 * ScrollPanel — state-based scrollable panel for Ink 6 (no overflow:scroll support).
 *
 * Takes an array of lines and renders only the visible window based on scrollOffset.
 * Supports stickyScroll (auto-follow bottom) and imperative scroll control.
 *
 * Usage:
 *   <ScrollPanel
 *     lines={lines}
 *     height={20}
 *     scrollOffset={offset}
 *     onScroll={setOffset}
 *     stickyScroll
 *   />
 */

import React, { useEffect, useRef } from "react";
import { Box, Text } from "ink";

interface ScrollPanelProps {
  /** Lines to render (pre-formatted strings or React elements). */
  lines: string[];
  /** Visible height in rows (excluding border/header). */
  height: number;
  /** Current scroll offset (0 = bottom, positive = scrolled up). */
  scrollOffset: number;
  /** Callback when scroll offset changes. */
  onScroll: (offset: number) => void;
  /** Auto-scroll to bottom when new lines arrive. Default: true. */
  stickyScroll?: boolean;
  /** Panel title (optional). */
  title?: string;
  /** Border style. */
  focused?: boolean;
  /** Line renderer (default: Text with dimColor). */
  renderLine?: (line: string, index: number) => React.ReactNode;
}

export function ScrollPanel({
  lines,
  height,
  scrollOffset,
  onScroll,
  stickyScroll = true,
  title,
  focused,
  renderLine,
}: ScrollPanelProps) {
  const prevLengthRef = useRef(lines.length);

  // Sticky scroll: when new lines arrive and offset is 0, stay at bottom
  useEffect(() => {
    if (stickyScroll && scrollOffset === 0 && lines.length > prevLengthRef.current) {
      // Already at bottom, no action needed
    }
    prevLengthRef.current = lines.length;
  }, [lines.length]);

  const visibleHeight = Math.max(height - (title ? 2 : 0), 1);
  const maxScroll = Math.max(0, lines.length - visibleHeight);
  const safeOffset = Math.min(scrollOffset, maxScroll);

  // Compute visible window (offset 0 = show last N lines)
  const startIdx = Math.max(0, lines.length - visibleHeight - safeOffset);
  const endIdx = startIdx + visibleHeight;
  const visibleLines = lines.slice(startIdx, endIdx);

  // Scroll percentage
  const scrollPct = lines.length > visibleHeight
    ? Math.round(((lines.length - safeOffset - visibleHeight) / (lines.length - visibleHeight)) * 100)
    : 100;

  const defaultRenderLine = (line: string, i: number) => (
    <Text key={i} wrap="truncate">{line}</Text>
  );

  const renderer = renderLine ?? defaultRenderLine;

  return (
    <Box
      flexDirection="column"
      borderStyle={focused ? "bold" : "single"}
      borderColor={focused ? "cyan" : undefined}
      paddingX={1}
      height={height}
    >
      {title && (
        <>
          <Box justifyContent="space-between">
            <Text bold>{title}</Text>
            {lines.length > visibleHeight && (
              <Text dimColor>
                {scrollPct}% {safeOffset > 0 ? "↑" : "↓"}
              </Text>
            )}
          </Box>
          <Text dimColor>{"─".repeat(30)}</Text>
        </>
      )}

      {visibleLines.length === 0 ? (
        <Text dimColor>(empty)</Text>
      ) : (
        visibleLines.map((line, i) => renderer(line, startIdx + i))
      )}
    </Box>
  );
}

/** Helper: scroll up/down by step. Returns new offset. */
export function scrollBy(current: number, delta: number, maxScroll: number): number {
  return Math.max(0, Math.min(current + delta, maxScroll));
}
