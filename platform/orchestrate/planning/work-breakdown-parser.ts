/**
 * Work Breakdown parser — assembles heading + field parsers into
 * the complete parseWorkBreakdown() function.
 *
 * PURE ASSEMBLY: no new parsing logic, just glue between
 * wb-heading-parser (scanHeadings) and wb-field-parser (parseFields).
 */

import { readFileSync } from 'node:fs';
import { scanHeadings } from './wb-heading-parser.js';
import { parseFields } from './wb-field-parser.js';
import type { WorkItem } from './types.js';

/**
 * Parse a work-breakdown markdown file into structured WorkItem objects.
 *
 * 1. Reads the file from disk.
 * 2. Scans headings to identify sections with positions and hierarchy.
 * 3. Extracts the body text between each pair of headings.
 * 4. Parses fields (targetFiles, dependsOn, action, etc.) from each body.
 * 5. Merges heading info + field info into complete WorkItem objects.
 * 6. Assigns parentId based on Phase/Step hierarchy.
 *
 * Returns [] for non-existent files (fail-safe).
 */
export function parseWorkBreakdown(wbPath: string): WorkItem[] {
  let content: string;
  try {
    content = readFileSync(wbPath, 'utf8');
  } catch (err) {
    console.warn(`[work-breakdown-parser] file read failed for ${wbPath}: ${(err as Error).message}`);
    return [];
  }

  const headings = scanHeadings(content);
  if (headings.length === 0) return [];

  const items: WorkItem[] = [];
  let currentParentId: string | undefined;

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    const nextOffset = i + 1 < headings.length ? headings[i + 1]!.offset : content.length;
    const body = content.slice(heading.offset, nextOffset);

    // Track parent hierarchy
    if (heading.isParent) {
      currentParentId = heading.id;
    }

    // Parse fields from the section body
    const fields = parseFields(body);

    // Heading-level size takes priority over body-level size
    const size = heading.size ?? fields.size;

    // Title: for ID-based items, extract from the heading line directly
    // (parseHeading gives us the tail after the ID; for parents it's the phase description)
    // For non-parent items, re-extract title to match original behavior:
    //   original regex: /^#{2,3}\s+ID[:\s]+(.+?)(?:\s*\((?:Size:)?\s*(?:XS|S|M)\))?$/m
    // parseHeading already does this — title is the text after ID, minus size parenthetical
    const title = heading.title || undefined;

    // Build the WorkItem
    const item: WorkItem = {
      id: heading.id,
      title,
      targetFiles: fields.targetFiles ?? [],
      ...(fields.dependsOn && fields.dependsOn.length > 0 ? { dependsOn: fields.dependsOn } : {}),
      ...(size ? { size } : {}),
      ...(fields.action ? { action: fields.action } : {}),
      ...(fields.contextBudget ? { contextBudget: fields.contextBudget } : {}),
      ...(fields.verify ? { verify: fields.verify } : {}),
      ...(fields.constraints ? { constraints: fields.constraints } : {}),
      ...(fields.done ? { done: fields.done } : {}),
      ...(heading.isParent
        ? { isParent: true, integrationTarget: fields.integrationTarget }
        : {}),
      ...(currentParentId && !heading.isParent
        ? { parentId: currentParentId }
        : {}),
    };

    items.push(item);
  }

  return items;
}
