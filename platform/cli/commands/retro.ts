/**
 * quorum retro — retrospective after audit approval.
 *
 * Extracts learnings from the audit cycle:
 * - What went well
 * - What went wrong
 * - Memory updates
 *
 * Then releases the session gate.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();

  console.log("\n\x1b[36mquorum retro\x1b[0m — retrospective\n");

  // Check retro marker
  const markerPath = resolve(repoRoot, ".session-state", "retro-marker.json");
  if (!existsSync(markerPath)) {
    console.log("  No retrospective pending (no retro marker found).");
    console.log("  Retro is triggered automatically after audit approval.\n");
    return;
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (err) {
    console.warn(`[retro] retro marker parse failed: ${(err as Error).message}`);
    marker = {};
  }

  console.log(`  Session: ${marker.session_id ?? "unknown"}`);
  console.log(`  RX ID: ${marker.rx_id ?? "unknown"}`);
  console.log();

  // Show audit history for this session
  const historyPath = resolve(repoRoot, ".claude", "audit-history.jsonl");
  if (existsSync(historyPath)) {
    const lines = readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean);
    const recent = lines.slice(-5);
    console.log("  \x1b[1mRecent audit history:\x1b[0m");
    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        const verdict = entry.verdict === "agree" ? "\x1b[32mapproved\x1b[0m" : "\x1b[31mrejected\x1b[0m";
        const codes = entry.rejection_codes?.length > 0 ? ` [${entry.rejection_codes.join(", ")}]` : "";
        console.log(`    ${entry.timestamp?.slice(0, 19) ?? "?"} ${verdict}${codes} ${entry.track ?? ""}`);
      } catch (err) { console.warn(`[retro] audit history line parse failed: ${(err as Error).message}`); }
    }
    console.log();
  }

  // ── --consolidate: run Dream consolidation (manual trigger) ──
  if (args.includes("--consolidate")) {
    console.log("  \x1b[36mRunning Dream consolidation (manual)...\x1b[0m\n");
    try {
      const __dir = dirname(fileURLToPath(import.meta.url));
      const quorumRoot = resolve(__dir, "..", "..", "..", "..");
      const engineUrl = pathToFileURL(resolve(quorumRoot, "platform", "core", "retro", "dream-engine.mjs")).href;
      const { runDream } = await import(engineUrl);
      const lockDir = resolve(repoRoot, ".session-state");

      // Gather audit history for consolidation
      const auditRecords = [];
      if (existsSync(historyPath)) {
        const lines = readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean);
        for (const line of lines.slice(-20)) {
          try { auditRecords.push(JSON.parse(line)); } catch { /* skip */ }
        }
      }

      const result = await runDream({
        trackName: marker.track ?? "unknown",
        waveIndex: marker.wave ?? 0,
        trigger: "manual",
        lockDir,
        auditRecords,
        memoryEntries: [],
      });

      if (result.status === "completed") {
        console.log(`  \x1b[32m✓ ${result.reason}\x1b[0m`);
        console.log(`  Duration: ${result.durationMs}ms\n`);
      } else if (result.status === "skipped") {
        console.log(`  \x1b[33m⚠ Skipped: ${result.reason}\x1b[0m\n`);
      } else {
        console.log(`  \x1b[31m✗ ${result.reason}\x1b[0m`);
        console.log("  (Consolidation failure does not affect retro gate)\n");
      }
    } catch (err) {
      console.log(`  \x1b[31m✗ Dream engine error: ${(err as Error).message}\x1b[0m`);
      console.log("  (Consolidation failure does not affect retro gate)\n");
    }
    return;
  }

  if (args.includes("--complete")) {
    // Release the gate
    try {
      rmSync(markerPath);
      console.log("  \x1b[32m✓ Retrospective completed. Session gate released.\x1b[0m");
      console.log("  Next: quorum merge\n");
    } catch (err) {
      console.log(`  \x1b[31m✗ Failed to remove marker: ${(err as Error).message}\x1b[0m\n`);
    }
    return;
  }

  console.log("  \x1b[1mReflect on this cycle:\x1b[0m");
  console.log("    1. What went well?");
  console.log("    2. What went wrong?");
  console.log("    3. What should be remembered for next time?");
  console.log();
  console.log("  When done, run: quorum retro --complete");
  console.log("  Or run Dream consolidation: quorum retro --consolidate\n");
}
