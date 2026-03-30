/**
 * RTM (Requirements Traceability Matrix) status update.
 *
 * Core logic is a pure function (updateRTMContent).
 * File-based wrapper (updateRTM) preserved for backward compatibility.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Minimal item shape needed for RTM update (id matching only). */
interface RTMItem {
  id: string;
}

/**
 * Pure function — update RTM markdown content for given items.
 * Replaces the status column (pending/implemented/failed) with the new status.
 *
 * @param rtmContent - Current RTM markdown content
 * @param items - Items whose status should be updated
 * @param status - New status value
 * @returns Updated RTM markdown content
 */
export function updateRTMContent(
  rtmContent: string,
  items: RTMItem[],
  status: "implemented" | "passed" | "failed",
): string {
  let content = rtmContent;
  for (const item of items) {
    const escapedId = item.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(\\|\\s*${escapedId}\\s*\\|[^\\n]*\\|)\\s*(?:pending|implemented|failed)\\s*\\|`,
    );
    content = content.replace(pattern, `$1 ${status} |`);
  }
  return content;
}

/**
 * File-based RTM update — reads file, updates status, writes back.
 * Three states: implemented (pre-audit), passed (audit OK), failed (audit rejected).
 *
 * Fail-open: silently returns on missing file or I/O error.
 */
export function updateRTM(
  rtmPath: string,
  items: RTMItem[],
  status: "implemented" | "passed" | "failed",
): void {
  if (!existsSync(rtmPath)) return;
  try {
    const content = readFileSync(rtmPath, "utf8");
    const updated = updateRTMContent(content, items, status);
    writeFileSync(rtmPath, updated, "utf8");
  } catch (err) { console.error(`[rtm-updater] updateRTM failed for ${rtmPath}: ${(err as Error).message}`); }
}
