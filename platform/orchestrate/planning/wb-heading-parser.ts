/**
 * WB heading parser — identifies and classifies markdown headings.
 *
 * Handles Phase/Step parents, ID-based items, size extraction, Korean labels.
 * ONLY heading identification — no field parsing (targetFiles, dependsOn, etc.).
 */

import type { HeadingInfo, WBSize } from './types.js';

// ── Regex patterns ──────────────────────────────

/**
 * ID pattern — matches WB item identifiers.
 * Examples: WEB-1, DAW-P2-01, FEAT-3A, PROJECT-TRACK-42
 * Must start with uppercase letter, contain at least one hyphen,
 * end with digits (optional letter suffix).
 */
export const ID_PATTERN = /[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?/;

/**
 * Parent label pattern — matches Phase/Step/단계 headings.
 * Examples: Phase 1, Step 2A, 단계 3
 */
export const PARENT_LABEL_PATTERN = /(?:Phase|Step|단계)\s*\d+[A-Za-z]?/;

/** Matches a Phase/Step parent heading line (## or ###). */
const PARENT_HEADING_RE = /^(#{2,3})\s+((?:Phase|Step|단계)\s*\d+[A-Za-z]?)\s*:\s*(.*)/;

/** Matches an ID-based heading line (## or ###), with optional brackets. */
const ID_HEADING_RE = /^(#{2,3})\s+(?:\[)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?)\]?\s*[:\s]\s*(.*)/;

/** Extracts size from a heading tail — "(Size: S)" or "(S)". */
const SIZE_IN_HEADING_RE = /\((?:Size:\s*)?(XS|S|M)\)\s*$/i;

// ── Heading classification ──────────────────────

export type HeadingKind = 'parent' | 'item' | 'none';

/**
 * Classify a single line as a Phase parent, WB item, or neither.
 * Does NOT require document-level context — operates on the line alone.
 */
export function classifyHeading(line: string): HeadingKind {
  if (PARENT_HEADING_RE.test(line)) return 'parent';
  if (ID_HEADING_RE.test(line)) return 'item';
  return 'none';
}

// ── Heading parsing ─────────────────────────────

/**
 * Parse a single markdown line into a HeadingInfo, or null if the line
 * is not a recognized WB heading.
 *
 * Phase/Step labels take precedence: if a line matches both the parent
 * pattern and the ID pattern, it is classified as a parent.
 */
export function parseHeading(line: string): HeadingInfo | null {
  // Try parent heading first (Phase/Step/단계)
  const parentMatch = line.match(PARENT_HEADING_RE);
  if (parentMatch) {
    const level = parentMatch[1]!.length;          // 2 or 3
    const rawLabel = parentMatch[2]!;              // "Phase 1", "Step 2A"
    const tail = parentMatch[3]!;                  // rest of heading
    const id = rawLabel.replace(/\s+/g, '-');      // "Phase-1"
    const { title, size } = extractSizeFromTail(tail);
    return { level, id, title, size, isParent: true };
  }

  // Try ID-based heading
  const idMatch = line.match(ID_HEADING_RE);
  if (idMatch) {
    const level = idMatch[1]!.length;
    const id = idMatch[2]!;
    const tail = idMatch[3]!;
    const { title, size } = extractSizeFromTail(tail);
    return { level, id, title, size, isParent: false };
  }

  return null;
}

// ── Document-level heading scan ─────────────────

/**
 * Scan an entire WB document and return all headings with positions.
 * Adds document-level context: in a file with Phase parents,
 * Phase headings are level 2 (parent) and ID headings become level 3
 * (child) regardless of their actual markdown level.
 *
 * Returns headings sorted by their byte offset in the document.
 */
export function scanHeadings(content: string): (HeadingInfo & { offset: number })[] {
  // Phase 1: detect document structure — does this file have Phase parents?
  const hasPhaseParents = /^#{2,3}\s+(?:Phase|Step|단계)\s*\d+[A-Za-z]?[:\s]/gm.test(content);

  // ID-based parents only when no Phase labels exist AND both h2+h3 IDs present
  const hasIdParents = !hasPhaseParents
    && /^##\s+(?:\[)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?\]?\s*[:\s]/gm.test(content)
    && /^###\s+(?:\[)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?\]?\s*[:\s]/gm.test(content);

  const hasParents = hasPhaseParents || hasIdParents;

  const results: (HeadingInfo & { offset: number })[] = [];
  const lines = content.split('\n');
  let offset = 0;

  for (const line of lines) {
    const info = parseHeading(line);
    if (info) {
      // Apply document-level parent/child classification
      if (hasParents) {
        if (info.isParent) {
          // Phase/Step heading — always parent (level 2)
          info.level = 2;
        } else if (hasIdParents && line.startsWith('## ')) {
          // ID at h2 when h2=parent mode — treat as parent
          info.level = 2;
          info.isParent = true;
        } else {
          // Child in a hierarchical document
          info.level = 3;
          info.isParent = false;
        }
      } else {
        // Flat document — all items are children
        info.isParent = false;
        info.level = 3;
      }
      results.push({ ...info, offset });
    }
    offset += line.length + 1; // +1 for newline
  }

  return results;
}

// ── Internal helpers ────────────────────────────

/** Strip size parenthetical from the tail of a heading and extract title + size. */
function extractSizeFromTail(tail: string): { title: string; size?: WBSize } {
  const sizeMatch = tail.match(SIZE_IN_HEADING_RE);
  if (sizeMatch) {
    const title = tail.slice(0, sizeMatch.index!).trim();
    const size = sizeMatch[1]!.toUpperCase() as WBSize;
    return { title, size };
  }
  return { title: tail.trim() };
}
