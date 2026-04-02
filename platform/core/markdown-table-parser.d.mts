/**
 * Parse a markdown table row into trimmed cells, stripping outer pipe boundaries.
 */
export function parseTableCells(line: string): string[];

/**
 * Check if a line is a markdown table separator (e.g. "|---|---|---|").
 */
export function isTableSeparator(line: string): boolean;

/**
 * Parse a complete markdown table from an array of lines.
 */
export function parseTable(
  lines: string[],
  startIndex?: number,
): { headers: string[]; rows: string[][]; startLine: number; endLine: number } | null;
