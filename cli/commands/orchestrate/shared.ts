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

export interface WorkItem {
  id: string;
  targetFiles: string[];
  dependsOn?: string[];
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
    const bridge = await import(toURL(resolve(repoRoot, "core", "bridge.mjs")));
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
        const idItems = content.match(/^##\s+[A-Z]{2,}-\d+/gm) ?? [];
        tracks.push({
          name: basename(resolve(fullPath, "..")),
          path: fullPath,
          items: Math.max(bracketItems.length, idItems.length),
        });
      }
    }
  } catch { /* skip */ }
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
  const sectionRegex = /^#{2,3}\s+(?:\[)?([A-Z][A-Z0-9]*-\d+)\]?\s+/gm;
  const sections: { id: string; start: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    sections.push({ id: match[1]!, start: match.index });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const end = i + 1 < sections.length ? sections[i + 1]!.start : content.length;
    const body = content.slice(section.start, end);

    const depsMatch = body.match(/(?:Prerequisite|depends_on)[:\s]+(.+)/i);
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

    items.push({
      id: section.id,
      targetFiles,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    });
  }

  return items;
}
