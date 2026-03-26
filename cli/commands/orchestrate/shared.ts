/**
 * Orchestrate shared utilities — types, bridge loader, track/WB parsing.
 *
 * Used by: planner.ts, runner.ts, lifecycle.ts, and the orchestrate dispatcher.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DIST = resolve(__dirname, "..", "..", "..");

// ── Types ────────────────────────────────────

export type Bridge = Record<string, Function>;

export type WBSize = "XS" | "S" | "M";

export interface WorkItem {
  id: string;
  /** Human-readable title from WB heading */
  title?: string;
  targetFiles: string[];
  dependsOn?: string[];
  /** WB complexity: XS (~15-50 lines), S (~60-150), M (~180-250) */
  size?: WBSize;
  /** Concrete action steps (what to do, not "implement X") */
  action?: string;
  /** Files to read (context) and files to skip */
  contextBudget?: { read: string[]; skip: string[] };
  /** Runnable verification command */
  verify?: string;
  /** Scope boundaries — what NOT to do */
  constraints?: string;
  /** Done criteria */
  done?: string;
}

export interface TrackInfo {
  name: string;
  path: string;
  items: number;
}

// ── Bridge loader ────────────────────────────

export async function loadBridge(repoRoot: string): Promise<Bridge | null> {
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    // Bridge is in the quorum package, not the target project
    const quorumRoot = resolve(DIST, "..");
    const bridge = await import(toURL(resolve(quorumRoot, "core", "bridge.mjs")));
    await bridge.init(repoRoot);
    return bridge;
  } catch { return null; }
}

// ── Track discovery ──────────────────────────

export function findTracks(repoRoot: string): TrackInfo[] {
  const tracks: TrackInfo[] = [];
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanDir(dir, tracks);
  }

  const seen = new Set<string>();
  return tracks.filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

function scanDir(dir: string, tracks: TrackInfo[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, tracks);
      } else if (entry.name.includes("work-breakdown") && entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf8");
        const bracketItems = content.match(/^###?\s+\[/gm) ?? [];
        const idItems = content.match(/^#{2,3}\s+[A-Z][A-Z0-9]*-\d+/gm) ?? [];
        tracks.push({
          name: basename(resolve(fullPath, "..")),
          path: fullPath,
          items: Math.max(bracketItems.length, idItems.length),
        });
      }
    }
  } catch { /* skip */ }
}

// ── Track resolution (name, index, or auto) ──

/**
 * Resolve a track by name, numeric index (1-based), or auto-select if only one exists.
 * Returns null if not found.
 */
export function resolveTrack(input: string | undefined, repoRoot: string): TrackInfo | null {
  const tracks = findTracks(repoRoot);
  if (tracks.length === 0) return null;

  // No input: auto-select if only one track
  if (!input) {
    return tracks.length === 1 ? tracks[0]! : null;
  }

  // Numeric index (1-based)
  const idx = parseInt(input, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= tracks.length) {
    return tracks[idx - 1]!;
  }

  // Exact name match
  const exact = tracks.find(t => t.name === input);
  if (exact) return exact;

  // Prefix match (case-insensitive)
  const prefix = tracks.filter(t => t.name.toLowerCase().startsWith(input.toLowerCase()));
  if (prefix.length === 1) return prefix[0]!;

  return null;
}

/**
 * Format a short track reference for next-step suggestions.
 * Uses index if available, falls back to name.
 */
export function trackRef(trackName: string, repoRoot: string): string {
  const tracks = findTracks(repoRoot);
  if (tracks.length === 1) return "";  // no arg needed
  const idx = tracks.findIndex(t => t.name === trackName);
  return idx >= 0 ? String(idx + 1) : trackName;
}

// ── Work Breakdown Parser ────────────────────

export function parseWorkBreakdown(wbPath: string): WorkItem[] {
  let content: string;
  try {
    content = readFileSync(wbPath, "utf8");
  } catch {
    return [];
  }

  const items: WorkItem[] = [];
  const sectionRegex = /^#{2,3}\s+(?:\[)?([A-Z][A-Z0-9]*-\d+)\]?[:\s]\s*/gm;
  const sections: { id: string; start: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({ id: match[1]!, start: match.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const end = i + 1 < sections.length ? sections[i + 1]!.start : content.length;
    const body = content.slice(section.start, end);

    // Size: XS, S, or M (from heading or Size field)
    const sizeFromHeading = body.match(/\((?:Size:\s*)?(XS|S|M)\)/i);
    const sizeFromField = body.match(/\*\*Size\*\*:\s*(XS|S|M)/i);
    const size = (sizeFromHeading?.[1] ?? sizeFromField?.[1])?.toUpperCase() as WBSize | undefined;

    const depsMatch = body.match(/(?:Prerequisite|depends_on|선행.?작업|블로커)[:\s]+(.+)/i);
    const dependsOn: string[] = [];
    if (depsMatch) {
      const depIds = depsMatch[1]!.match(/[A-Z][A-Z0-9]*-\d+/g);
      if (depIds) dependsOn.push(...depIds);
    }

    const targetFiles: string[] = [];
    const fileRegex = /`([^`]+\.[a-z]{1,5})`/g;
    const firstTouchStart = body.indexOf("First touch files");
    if (firstTouchStart !== -1) {
      const nextSection = body.indexOf("\n- **", firstTouchStart + 1);
      const fileBlock = nextSection !== -1
        ? body.slice(firstTouchStart, nextSection)
        : body.slice(firstTouchStart, Math.min(firstTouchStart + 500, body.length));
      let fileMatch: RegExpExecArray | null;
      while ((fileMatch = fileRegex.exec(fileBlock)) !== null) {
        targetFiles.push(fileMatch[1]!);
      }
    }

    // Action: concrete steps (multi-line until next field)
    const actionMatch = body.match(/\*\*Action\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i);
    const action = actionMatch?.[1]?.trim() || undefined;

    // Context budget: Read / Skip lists
    const ctxMatch = body.match(/\*\*Context budget\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*(?!Read|Skip)|\n##|$)/i);
    const ctxBlock = ctxMatch?.[1] ?? "";
    const readFiles: string[] = [];
    const skipFiles: string[] = [];
    const readMatch = ctxBlock.match(/Read:\s*(.+)/i);
    if (readMatch) {
      let fm: RegExpExecArray | null;
      while ((fm = fileRegex.exec(readMatch[1]!)) !== null) readFiles.push(fm[1]!);
    }
    const skipMatch = ctxBlock.match(/Skip:\s*(.+)/i);
    if (skipMatch) skipFiles.push(...skipMatch[1]!.split(/[,;]/).map(s => s.replace(/`/g, "").trim()).filter(Boolean));
    const contextBudget = (readFiles.length > 0 || skipFiles.length > 0)
      ? { read: readFiles, skip: skipFiles } : undefined;

    // Verify: runnable command
    const verifyMatch = body.match(/\*\*Verify\*\*:\s*`([^`]+)`/i)
      ?? body.match(/\*\*Verify\*\*:\s*(.+)/i);
    const verify = verifyMatch?.[1]?.trim() || undefined;

    // Constraints: scope boundaries
    const constraintsMatch = body.match(/\*\*Constraints?\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i);
    const constraints = constraintsMatch?.[1]?.trim() || undefined;

    // Done: completion criteria
    const doneMatch = body.match(/\*\*Done\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i);
    const done = doneMatch?.[1]?.trim() || undefined;

    // Title: extract from heading (e.g., "### OIN-1: Project Scaffolding (Size: S)")
    const titleMatch = body.match(/^#{2,3}\s+[A-Z][A-Z0-9]*-\d+[:\s]+(.+?)(?:\s*\((?:Size:)?\s*(?:XS|S|M)\))?$/m);
    const title = titleMatch?.[1]?.trim() || undefined;

    items.push({
      id: section.id,
      title,
      targetFiles,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      size,
      action,
      contextBudget,
      verify,
      constraints,
      done,
    });
  }

  return items;
}

// ── Plan Review Gate ─────────────────────────

export interface PlanReviewResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Structural validation of WBs before execution.
 * Ensures each item has the required fields for sub-agent single-pass completion.
 */
export function reviewPlan(items: WorkItem[]): PlanReviewResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (items.length === 0) {
    errors.push("No work items found");
    return { passed: false, warnings, errors };
  }

  for (const item of items) {
    const prefix = `[${item.id}]`;

    // Required: target files
    if (item.targetFiles.length === 0) {
      warnings.push(`${prefix} No target files — agent must discover targets`);
    }

    // Required: action (the whole point of the schema change)
    if (!item.action) {
      errors.push(`${prefix} Missing Action — sub-agent cannot execute without concrete steps`);
    }

    // Required: verify command
    if (!item.verify) {
      errors.push(`${prefix} Missing Verify — no way to confirm completion`);
    } else if (!/[a-z]/.test(item.verify) || item.verify.length < 5) {
      warnings.push(`${prefix} Verify looks too short — should be a runnable command`);
    }

    // Recommended: constraints
    if (!item.constraints) {
      warnings.push(`${prefix} No Constraints — scope boundary unspecified`);
    }

    // Recommended: size
    if (!item.size) {
      warnings.push(`${prefix} No Size — model tier routing will use default`);
    }

    // Guard: too many target files suggests WB is too large
    if (item.targetFiles.length > 5) {
      errors.push(`${prefix} ${item.targetFiles.length} target files — split this WB`);
    }
  }

  // Cross-item: check for dependency on non-existent items
  const ids = new Set(items.map(i => i.id));
  for (const item of items) {
    for (const dep of item.dependsOn ?? []) {
      if (!ids.has(dep)) {
        errors.push(`[${item.id}] depends on ${dep} which does not exist`);
      }
    }
  }

  return { passed: errors.length === 0, warnings, errors };
}
