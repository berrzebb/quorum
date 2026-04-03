/** @module Compatibility shell — real implementation in orchestrate/planning/ and orchestrate/core/ */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findTracks, trackRef } from "./shared.js";
import { runPlannerSession, slugify } from "../../../orchestrate/planning/planner-session.js";

// ── Re-exports from orchestrate/planning/ ────
export { autoGenerateWBs, autoFixDesignDiagrams } from "../../../orchestrate/planning/auto-planner.js";

// ── CLI entry point (presentation only) ──────

export async function interactivePlanner(repoRoot: string, args: string[]): Promise<void> {
  const providerIdx = args.indexOf("--provider");
  const provider = providerIdx >= 0 ? args[providerIdx + 1] ?? "claude" : "claude";
  const useMux = args.includes("--mux");
  const useAuto = args.includes("--auto");
  const providerValue = providerIdx >= 0 ? args[providerIdx + 1] : undefined;
  const trackInput = args.find(a => !a.startsWith("--") && a !== providerValue);

  const trackName = trackInput ?? (findTracks(repoRoot).length === 1 ? findTracks(repoRoot)[0]!.name : undefined);

  if (!trackName) {
    console.log("  Usage: quorum orchestrate plan <track|index> [--provider claude|codex|gemini|ollama|vllm] [--mux]\n");
    const tracks = findTracks(repoRoot);
    if (tracks.length > 0) {
      console.log("  Available tracks:");
      for (let i = 0; i < tracks.length; i++) {
        console.log(`    ${i + 1}. ${tracks[i]!.name} (${tracks[i]!.items} items)`);
      }
      console.log();
    }
    return;
  }

  console.log(`\n\x1b[36mquorum orchestrate plan\x1b[0m\n`);

  const result = await runPlannerSession({ repoRoot, trackName, provider, useMux, useAuto });

  const planDir = resolve(repoRoot, "docs", "plan");
  const slug = result.trackSlug;
  const wbPath = resolve(planDir, slug, "work-breakdown.md");
  if (existsSync(wbPath)) {
    const ref = trackRef(slug, repoRoot);
    const arg = ref ? ` ${ref}` : "";
    console.log(`\n  \x1b[32m✓ WBs generated.\x1b[0m Next: quorum orchestrate run${arg}\n`);
  }
}
