/**
 * track-archive/index.mjs — Tool: track_archive
 *
 * Archive completed track planning artifacts to date-stamped directory.
 * Extracted from tool-core.mjs (SPLIT-4).
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync as _writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve, relative } from "node:path";
import { safePath, _cwd } from "../tool-utils.mjs";

// ═══ Helpers ═══════════════════════════════════════════════════════════

/**
 * Classify artifact by filename.
 */
function classifyArtifact(name) {
  const lower = name.toLowerCase();
  if (lower.includes("prd")) return "PRD";
  if (lower.includes("drm")) return "DRM";
  if (lower.includes("work-breakdown") || lower.includes("wb")) return "WB";
  if (lower.includes("rtm")) return "RTM";
  if (lower.includes("design") || lower.includes("spec") || lower.includes("blueprint")) return "design";
  if (lower.includes("handoff")) return "handoff";
  if (lower.includes("wave-state")) return "state";
  if (lower.includes("cps")) return "CPS";
  return "artifact";
}

// ═══ Tool: track_archive ═══════════════════════════════════════════════

/**
 * track_archive — Move completed track artifacts to archive directory.
 *
 * @param {{ track: string, path?: string, dry_run?: boolean }} params
 * @returns {{ text: string, summary: string, json?: object } | { error: string }}
 */
export function toolTrackArchive(params) {
  const { track, dry_run = false } = params;
  if (!track) return { error: "track name is required" };

  const repoRoot = params.path ? safePath(params.path) : _cwd;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const archiveDir = resolve(repoRoot, ".claude", "quorum", "archive", dateStr, track);

  // Scan for track artifacts
  const artifacts = [];

  // 1. Planning directory (.claude/quorum/{track}/ or .claude/planning/{track}/)
  const planningDirs = [
    resolve(repoRoot, ".claude", "quorum", track),
    resolve(repoRoot, ".claude", "planning", track),
    resolve(repoRoot, ".claude", track),
  ];

  for (const dir of planningDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) {
          artifacts.push({
            source: resolve(dir, e.name),
            relSource: relative(repoRoot, resolve(dir, e.name)).replace(/\\/g, "/"),
            name: e.name,
            type: classifyArtifact(e.name),
          });
        }
      }
    } catch (err) { console.warn("[track-archive] operation failed:", err?.message ?? err); }
  }

  // 2. Design docs (design/{track}/ or .claude/quorum/design/{track}/)
  const designDirs = [
    resolve(repoRoot, "design", track),
    resolve(repoRoot, ".claude", "quorum", "design", track),
  ];
  for (const dir of designDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) {
          artifacts.push({
            source: resolve(dir, e.name),
            relSource: relative(repoRoot, resolve(dir, e.name)).replace(/\\/g, "/"),
            name: e.name,
            type: "design",
          });
        }
      }
    } catch (err) { console.warn("[track-archive] operation failed:", err?.message ?? err); }
  }

  // 3. Wave state
  const waveState = resolve(repoRoot, ".claude", "quorum", `wave-state-${track}.json`);
  if (existsSync(waveState)) {
    artifacts.push({
      source: waveState,
      relSource: relative(repoRoot, waveState).replace(/\\/g, "/"),
      name: `wave-state-${track}.json`,
      type: "state",
    });
  }

  // 4. Handoff file
  const handoff = resolve(repoRoot, ".claude", "quorum", `handoff-${track}.md`);
  if (existsSync(handoff)) {
    artifacts.push({
      source: handoff,
      relSource: relative(repoRoot, handoff).replace(/\\/g, "/"),
      name: `handoff-${track}.md`,
      type: "handoff",
    });
  }

  if (artifacts.length === 0) {
    return { error: `No artifacts found for track "${track}"` };
  }

  // Format report
  const lines = [`# Track Archive: ${track}`, ``];
  lines.push(`Date: ${dateStr}`);
  lines.push(`Archive: \`.claude/quorum/archive/${dateStr}/${track}/\``);
  lines.push(`Mode: ${dry_run ? "dry-run (no changes)" : "archive"}`);
  lines.push(``);

  // Group by type
  const byType = {};
  for (const a of artifacts) {
    (byType[a.type] = byType[a.type] || []).push(a);
  }

  lines.push(`## Artifacts (${artifacts.length})`, ``);
  lines.push(`| Type | File | Source |`);
  lines.push(`|------|------|--------|`);
  for (const a of artifacts) {
    lines.push(`| ${a.type} | ${a.name} | \`${a.relSource}\` |`);
  }
  lines.push(``);

  // Execute archive (move files)
  if (!dry_run) {
    mkdirSync(archiveDir, { recursive: true });
    let moved = 0;
    const errors = [];

    for (const a of artifacts) {
      const dest = resolve(archiveDir, a.name);
      try {
        // Copy first, then delete (cross-device safe)
        copyFileSync(a.source, dest);
        unlinkSync(a.source);
        moved++;
      } catch (e) {
        errors.push(`${a.name}: ${e.message}`);
      }
    }

    lines.push(`## Result`, ``);
    lines.push(`Archived: ${moved} / ${artifacts.length} files`);
    if (errors.length > 0) {
      lines.push(`Errors: ${errors.length}`);
      for (const e of errors) lines.push(`- ${e}`);
    }

    // Write summary manifest
    const manifest = {
      track,
      date: dateStr,
      artifacts: artifacts.map(a => ({ name: a.name, type: a.type, source: a.relSource })),
      archivedAt: now.toISOString(),
    };
    _writeFileSync(resolve(archiveDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  }

  const summary = dry_run
    ? `${artifacts.length} artifacts found for "${track}" (dry-run)`
    : `Archived ${artifacts.length} artifacts for "${track}" to .claude/quorum/archive/${dateStr}/${track}/`;

  return { text: lines.join("\n"), summary, json: { track, date: dateStr, count: artifacts.length, artifacts } };
}
