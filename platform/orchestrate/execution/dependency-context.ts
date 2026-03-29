/**
 * Dependency context builder — reads wave manifests, produces prompt text.
 *
 * Pure function. Takes manifest data, returns context string.
 * No file I/O, no SQLite access.
 */

import type { WorkItem } from "../planning/types.js";

// ── Manifest type ────────────────────────────

export interface WaveManifest {
  trackName: string;
  waveIndex: number;
  completedItems: string[];
  changedFiles: string[];
  fileExports: Record<string, string[]>;
  recordedAt: number;
}

/**
 * Build dependency context from MessageBus manifests.
 * Mechanical injection — orchestrator reads SQLite, injects into prompt.
 *
 * Filters manifests to only those containing items in `item.dependsOn`,
 * then formats changed files + exports as markdown sections.
 */
export function buildDepContextFromManifests(item: WorkItem, manifests: WaveManifest[]): string {
  if (!item.dependsOn || item.dependsOn.length === 0 || manifests.length === 0) return "";
  const depSet = new Set(item.dependsOn);
  const sections: string[] = [];

  for (const m of manifests) {
    const relevantDeps = m.completedItems.filter(id => depSet.has(id));
    if (relevantDeps.length === 0) continue;

    const fileEntries: string[] = [];
    for (const [file, exports] of Object.entries(m.fileExports)) {
      fileEntries.push(`### ${file}\n\`\`\`\n${exports.join("\n")}\n\`\`\``);
    }

    if (fileEntries.length > 0) {
      sections.push(`## Wave ${m.waveIndex + 1} (${relevantDeps.join(", ")})\nChanged: ${m.changedFiles.join(", ")}\n\n${fileEntries.join("\n\n")}`);
    } else if (m.changedFiles.length > 0) {
      sections.push(`## Wave ${m.waveIndex + 1} (${relevantDeps.join(", ")})\nChanged: ${m.changedFiles.join(", ")}`);
    }
  }

  return sections.length > 0
    ? `# Dependency Output (from MessageBus)\n\n${sections.join("\n\n---\n\n")}\n`
    : "";
}
