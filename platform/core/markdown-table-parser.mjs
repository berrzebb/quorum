/**
 * Shared markdown table parsing utilities.
 *
 * Consolidates repeated `line.split("|").map(c => c.trim()).filter(...)` patterns
 * used across RTM parsers, blueprint lint, graph bootstrap, and plan commands.
 *
 * @module core/markdown-table-parser
 */

/**
 * Parse a markdown table row into trimmed cells, stripping outer pipe boundaries.
 *
 * Given `"| a | b | c |"`, the raw split produces `["", " a ", " b ", " c ", ""]`.
 * This function trims each cell and strips the first/last empty entries from pipes,
 * preserving any empty middle cells (e.g. `"| a | | c |"` → `["a", "", "c"]`).
 *
 * @param {string} line - A markdown table row (e.g. "| a | b | c |")
 * @returns {string[]} Trimmed cells with outer pipe boundaries removed
 */
export function parseTableCells(line) {
  return line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length);
}

/**
 * Check if a line is a markdown table separator (e.g. "|---|---|---|").
 *
 * Handles both standard separators and those with alignment colons (`:---:`, `:---`, `---:`).
 *
 * @param {string} line - A line of markdown text
 * @returns {boolean} True if the line is a table separator row
 */
export function isTableSeparator(line) {
  const trimmed = line.trim();
  return /^\|[\s:]*-[-\s:|]*\|$/.test(trimmed) ||
    trimmed.split("|").filter(Boolean).every(c => /^[\s:]*-+[\s:]*$/.test(c));
}

/**
 * Parse a complete markdown table from an array of lines.
 *
 * Scans forward from `startIndex` looking for a header row (a pipe-containing line
 * followed by a separator row). Collects all subsequent pipe-containing rows as data.
 *
 * @param {string[]} lines - All lines of the markdown content
 * @param {number} [startIndex=0] - Where to start looking for a table
 * @returns {{ headers: string[], rows: string[][], startLine: number, endLine: number } | null}
 */
export function parseTable(lines, startIndex = 0) {
  for (let i = startIndex; i < lines.length - 1; i++) {
    if (!lines[i].includes("|")) continue;
    if (!isTableSeparator(lines[i + 1])) continue;

    const headers = parseTableCells(lines[i]);
    if (headers.length === 0) continue;

    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].includes("|")) {
      const cells = parseTableCells(lines[j]);
      if (cells.length > 0) rows.push(cells);
      j++;
    }

    return { headers, rows, startLine: i, endLine: j - 1 };
  }
  return null;
}
