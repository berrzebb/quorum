/**
 * Output Tail Reader — delta-only read for long-running session output.
 *
 * Adopted from Claude Code Task.ts outputFile/outputOffset pattern.
 * Instead of re-reading the entire output file on every poll,
 * maintains an offset cursor and reads only new bytes.
 *
 * Features:
 * - Append-only file assumption (provider output)
 * - Cursor-based delta read (outputOffset tracks position)
 * - Truncation detection (file smaller than cursor → reset)
 * - Max read budget per poll (prevents memory spikes)
 * - Line-aligned reads (avoids partial JSON/NDJSON)
 *
 * @module orchestrate/execution/output-tail
 */

import { openSync, readSync, fstatSync, closeSync } from "node:fs";

// ── Types ───────────────────────────────────────────

export interface OutputCursor {
  /** Path to the output file. */
  filePath: string;
  /** Current byte offset (0 = start). */
  offset: number;
  /** Last known file size in bytes. */
  lastSize: number;
  /** Whether the cursor has been reset due to truncation. */
  wasReset: boolean;
}

export interface TailReadResult {
  /** New content since last read (UTF-8 string). */
  content: string;
  /** Number of new bytes read. */
  bytesRead: number;
  /** Whether the file was truncated/rotated since last read. */
  truncated: boolean;
  /** Updated cursor (pass this back to next read call). */
  cursor: OutputCursor;
}

// ── Constants ───────────────────────────────────────

/** Max bytes to read per poll (64KB default — prevents memory spikes). */
const DEFAULT_MAX_READ = 64 * 1024;

// ── Factory ─────────────────────────────────────────

/**
 * Create a fresh output cursor for a file path.
 */
export function createCursor(filePath: string): OutputCursor {
  return {
    filePath,
    offset: 0,
    lastSize: 0,
    wasReset: false,
  };
}

// ── Core read ───────────────────────────────────────

/**
 * Read new content from the output file since the cursor position.
 *
 * - If the file doesn't exist yet, returns empty content.
 * - If the file shrank (truncation/rotation), resets cursor to 0.
 * - Reads up to maxBytes of new content (default 64KB).
 * - Aligns to last newline to avoid partial NDJSON lines.
 *
 * @param cursor — current cursor state
 * @param maxBytes — max bytes to read per call (default 64KB)
 * @returns TailReadResult with new content and updated cursor
 */
export function tailRead(cursor: OutputCursor, maxBytes = DEFAULT_MAX_READ): TailReadResult {
  let fd: number;
  try {
    fd = openSync(cursor.filePath, "r");
  } catch {
    return {
      content: "",
      bytesRead: 0,
      truncated: false,
      cursor: { ...cursor, wasReset: false },
    };
  }

  try {
    const stat = fstatSync(fd);
    const currentSize = stat.size;

    // Truncation detection: file is smaller than our cursor
    let truncated = false;
    let readOffset = cursor.offset;
    if (currentSize < cursor.offset) {
      truncated = true;
      readOffset = 0; // Reset to beginning
    }

    // Nothing new to read
    if (currentSize <= readOffset) {
      return {
        content: "",
        bytesRead: 0,
        truncated,
        cursor: {
          filePath: cursor.filePath,
          offset: readOffset,
          lastSize: currentSize,
          wasReset: truncated,
        },
      };
    }

    // Calculate how much to read (capped by maxBytes)
    const available = currentSize - readOffset;
    const toRead = Math.min(available, maxBytes);

    // Read into buffer
    const buf = Buffer.alloc(toRead);
    const bytesRead = readSync(fd, buf, 0, toRead, readOffset);

    if (bytesRead === 0) {
      return {
        content: "",
        bytesRead: 0,
        truncated,
        cursor: {
          filePath: cursor.filePath,
          offset: readOffset,
          lastSize: currentSize,
          wasReset: truncated,
        },
      };
    }

    // Line-align: if we didn't read to EOF, trim to last newline
    let content = buf.toString("utf8", 0, bytesRead);
    let actualBytes = bytesRead;

    if (readOffset + bytesRead < currentSize) {
      const lastNewline = content.lastIndexOf("\n");
      if (lastNewline >= 0) {
        content = content.slice(0, lastNewline + 1);
        actualBytes = Buffer.byteLength(content, "utf8");
      }
    }

    return {
      content,
      bytesRead: actualBytes,
      truncated,
      cursor: {
        filePath: cursor.filePath,
        offset: readOffset + actualBytes,
        lastSize: currentSize,
        wasReset: truncated,
      },
    };
  } finally {
    closeSync(fd);
  }
}

/**
 * Read ALL remaining content from cursor to EOF.
 * Use sparingly — for final reads when session completes.
 */
export function tailReadAll(cursor: OutputCursor): TailReadResult {
  return tailRead(cursor, Number.MAX_SAFE_INTEGER);
}

/**
 * Check if there's new content available without reading it.
 * Useful for conditional polling (skip expensive reads when nothing new).
 */
export function hasNewContent(cursor: OutputCursor): boolean {
  let fd: number;
  try {
    fd = openSync(cursor.filePath, "r");
  } catch {
    return false;
  }
  try {
    const stat = fstatSync(fd);
    return stat.size > cursor.offset;
  } finally {
    closeSync(fd);
  }
}
