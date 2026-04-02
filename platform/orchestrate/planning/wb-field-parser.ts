/**
 * WB field parser — extracts structured fields from a WB section body.
 *
 * Given the text between two headings, parses out targetFiles, dependsOn,
 * action, contextBudget, verify, constraints, done, size, and
 * integrationTarget.
 *
 * ONLY field extraction — no heading detection (see wb-heading-parser.ts).
 * Pure functions — no fs, no path, no side effects.
 */

import type { WorkItem, WBSize } from './types.js';

// ── Individual field extractors ──────────────────

/**
 * Extract target files from "First touch files" or "Target Files" fields.
 * Collects backtick-quoted filenames — supports extensions of any length
 * and dotfiles without extensions (e.g. `.gitignore`, `.env.example`).
 */
export function extractTargetFiles(body: string): string[] {
  const files: string[] = [];
  const fieldStart = body.search(/(?:First touch files|\*\*Target Files?\*\*)\s*:?/i);
  if (fieldStart === -1) return files;

  const nextSection = body.indexOf('\n- **', fieldStart + 1);
  const nextHeading = body.indexOf('\n##', fieldStart + 1);
  const nextBlank = body.indexOf('\n\n', fieldStart + 1);
  const ends = [nextSection, nextHeading, nextBlank].filter(i => i > fieldStart);
  const end = ends.length > 0 ? Math.min(...ends) : Math.min(fieldStart + 500, body.length);
  const fileBlock = body.slice(fieldStart, end);

  // Match backtick-quoted paths:
  //  - files with extensions: `foo.js`, `src/db/schema.js`, `.env.example`
  //  - dotfiles without extensions: `.gitignore`, `.gitkeep`, `.env`
  const fileRegex = /`((?:[^`]*\/)?(?:[^`/]+\.[a-z][a-z0-9]*|\.[a-z][a-z0-9]*))`/g;
  let m: RegExpExecArray | null;
  while ((m = fileRegex.exec(fileBlock)) !== null) {
    files.push(m[1]!);
  }
  return files;
}

/**
 * Extract dependency IDs from "Prerequisite", "depends_on", etc.
 * Returns WB-style IDs (e.g. DAW-P2-01, GATE-1).
 */
export function extractDependsOn(body: string): string[] {
  const match = body.match(
    /\*{0,2}(?:Prerequisite|depends_on|선행.?작업|블로커)\*{0,2}\s*:\s*(.+)/i,
  );
  if (!match) return [];
  const ids = match[1]!.match(/[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?/g);
  return ids ?? [];
}

/**
 * Extract concrete action steps (multi-line, up to next field or heading).
 */
export function extractAction(body: string): string | undefined {
  const m = body.match(/\*\*Action\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i);
  return m?.[1]?.trim() || undefined;
}

/**
 * Extract backtick-quoted file paths from the Action block.
 * Agents create files mentioned in Action that may not be in "First touch files".
 * Filters out non-file patterns (commands, flags, package names without paths).
 */
export function extractFilesFromAction(body: string): string[] {
  const actionText = extractAction(body);
  if (!actionText) return [];

  const files: string[] = [];
  // Same regex as extractTargetFiles — backtick-quoted paths with extensions or dotfiles
  const fileRegex = /`((?:[^`]*\/)?(?:[^`/]+\.[a-z][a-z0-9]*|\.[a-z][a-z0-9]*))`/g;
  let m: RegExpExecArray | null;
  while ((m = fileRegex.exec(actionText)) !== null) {
    const path = m[1]!;
    // Filter out common false positives: npm commands, flags, version strings
    if (path.startsWith("--") || path.startsWith("npm ") || path.startsWith("npx ")) continue;
    if (/^\d+\.\d+/.test(path)) continue;  // version numbers like 1.0.0
    files.push(path);
  }
  return files;
}

/**
 * Extract context budget — Read and Skip file lists.
 */
export function extractContextBudget(
  body: string,
): { read: string[]; skip: string[] } | undefined {
  const ctxMatch = body.match(
    /\*\*Context budget\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*(?!Read|Skip)|\n##|$)/i,
  );
  const ctxBlock = ctxMatch?.[1] ?? '';

  const readFiles: string[] = [];
  const skipFiles: string[] = [];

  const readMatch = ctxBlock.match(/Read:\s*(.+)/i);
  if (readMatch) {
    const fileRegex = /`((?:[^`]*\/)?(?:[^`/]+\.[a-z][a-z0-9]*|\.[a-z][a-z0-9]*))`/g;
    let fm: RegExpExecArray | null;
    while ((fm = fileRegex.exec(readMatch[1]!)) !== null) {
      readFiles.push(fm[1]!);
    }
  }

  const skipMatch = ctxBlock.match(/Skip:\s*(.+)/i);
  if (skipMatch) {
    skipFiles.push(
      ...skipMatch[1]!
        .split(/[,;]/)
        .map(s => s.replace(/`/g, '').trim())
        .filter(Boolean),
    );
  }

  if (readFiles.length > 0 || skipFiles.length > 0) {
    return { read: readFiles, skip: skipFiles };
  }
  return undefined;
}

/**
 * Extract runnable verification command from "Verify" field.
 * Prefers backtick-wrapped commands; falls back to bare text.
 */
export function extractVerify(body: string): string | undefined {
  const m =
    body.match(/\*\*Verify\*\*:\s*`([^`]+)`/i) ??
    body.match(/\*\*Verify\*\*:\s*(.+)/i);
  return m?.[1]?.trim() || undefined;
}

/**
 * Extract scope constraints from "Constraint(s)" field.
 */
export function extractConstraints(body: string): string | undefined {
  const m = body.match(
    /\*\*Constraints?\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i,
  );
  return m?.[1]?.trim() || undefined;
}

/**
 * Extract done/completion criteria from "Done" field.
 */
export function extractDone(body: string): string | undefined {
  const m = body.match(
    /\*\*Done\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|\n---|\n\n|$)/i,
  );
  return m?.[1]?.trim().replace(/\n---$/, '').trim() || undefined;
}

/**
 * Extract size from body fields (not heading parenthetical).
 * Matches "**Size**: S" style fields and "(Size: S)" inline.
 */
export function extractSizeFromBody(body: string): WBSize | undefined {
  const fromHeading = body.match(/\((?:Size:\s*)?(XS|S|M)\)/i);
  const fromField = body.match(/\*\*Size\*\*:\s*(XS|S|M)/i);
  const raw = fromHeading?.[1] ?? fromField?.[1];
  return raw ? (raw.toUpperCase() as WBSize) : undefined;
}

/**
 * Extract integration target (parent-only field).
 */
export function extractIntegrationTarget(body: string): string | undefined {
  const m = body.match(
    /\*\*(?:Integration[_ ]target|통합[_ ]대상)\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i,
  );
  return m?.[1]?.trim() || undefined;
}

// ── Composite field parser ───────────────────────

/**
 * Parse all WB fields from a section body (text between two headings).
 * Returns a partial WorkItem — caller merges with heading-level data
 * (id, title, isParent, parentId, heading-level size).
 */
export function parseFields(sectionBody: string): Partial<WorkItem> {
  // Merge files from First touch files + Action block (agents create files in Action too)
  const firstTouchFiles = extractTargetFiles(sectionBody);
  const actionFiles = extractFilesFromAction(sectionBody);
  const targetFiles = [...new Set([...firstTouchFiles, ...actionFiles])];
  const dependsOn = extractDependsOn(sectionBody);
  const action = extractAction(sectionBody);
  const contextBudget = extractContextBudget(sectionBody);
  const verify = extractVerify(sectionBody);
  const constraints = extractConstraints(sectionBody);
  const done = extractDone(sectionBody);
  const size = extractSizeFromBody(sectionBody);
  const integrationTarget = extractIntegrationTarget(sectionBody);

  return {
    targetFiles,
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
    ...(size ? { size } : {}),
    ...(action ? { action } : {}),
    ...(contextBudget ? { contextBudget } : {}),
    ...(verify ? { verify } : {}),
    ...(constraints ? { constraints } : {}),
    ...(done ? { done } : {}),
    ...(integrationTarget ? { integrationTarget } : {}),
  };
}
