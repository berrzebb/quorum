/**
 * TranscriptSelection — pure utility for transcript text selection.
 *
 * No React dependency. Provides selection range + copy text utilities
 * for the transcript pane.
 */

export interface TranscriptSelection {
  startLine: number;
  endLine: number;
  text: string;
}

/**
 * Create a selection from a range of transcript lines.
 *
 * Handles reversed start/end (user selects bottom-to-top).
 * Returns the selected text as a newline-joined string.
 */
export function createSelection(lines: string[], start: number, end: number): TranscriptSelection {
  const actualStart = Math.min(start, end);
  const actualEnd = Math.max(start, end);
  const clampedStart = Math.max(0, actualStart);
  const clampedEnd = Math.min(lines.length - 1, actualEnd);
  const selectedLines = lines.slice(clampedStart, clampedEnd + 1);
  return {
    startLine: clampedStart,
    endLine: clampedEnd,
    text: selectedLines.join("\n"),
  };
}

/**
 * Clear the current selection.
 *
 * Returns null to indicate no active selection.
 */
export function clearSelection(): TranscriptSelection | null {
  return null;
}
