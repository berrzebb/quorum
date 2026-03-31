#!/usr/bin/env node
/**
 * Codex Stop Review Gate — runs a Codex adversarial review before session end.
 *
 * Integrates codex-plugin-cc's stop-review-gate pattern into quorum's
 * hook chain. If codex-plugin-cc is installed and the stop gate is enabled,
 * delegates to codex-companion.mjs for a stop-time review.
 *
 * When codex-plugin-cc is NOT installed, falls back to quorum's own
 * fitness-based gate check.
 *
 * Output: JSON to stdout with { decision: "allow"|"block", reason?: string }
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHookContext, readStdinJson } from "../../../shared/hook-io.mjs";

const { REPO_ROOT, cfg, configMissing } = createHookContext(import.meta.url);
if (configMissing) process.exit(0);

const input = await readStdinJson({ exitOnEmpty: false, fallback: {} });

// ── Gate 1: Fitness score check ─────────────────────

const fitnessThreshold = cfg.stopReviewGate?.fitnessThreshold ?? 0.7;

// Try to read latest fitness score from SQLite state
let fitness = null;
try {
  const { loadBridge } = await import("../../../../core/bridge.mjs");
  const bridge = loadBridge(REPO_ROOT, cfg.hooks);
  const fitnessData = bridge.queryFitness?.();
  if (fitnessData?.overall != null) {
    fitness = fitnessData.overall;
  }
} catch {
  // bridge not available — skip fitness check
}

if (typeof fitness === "number" && fitness < fitnessThreshold) {
  const result = {
    decision: "block",
    reason: `Fitness score ${fitness.toFixed(2)} below threshold ${fitnessThreshold}. Address quality gates before ending session.`,
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

// ── Gate 2: codex-plugin-cc stop review (if available) ──

// Check if codex-plugin-cc stop gate is enabled in config
const stopGateEnabled = cfg.stopReviewGate?.enabled ?? false;

if (!stopGateEnabled) {
  // Stop gate not enabled — allow through
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  process.exit(0);
}

// Try to find codex-plugin-cc's companion script
const companionPaths = [
  process.env.CODEX_COMPANION_SCRIPT,
  process.env.CLAUDE_PLUGIN_DATA && resolve(process.env.CLAUDE_PLUGIN_DATA, "..", "codex", "scripts", "codex-companion.mjs"),
].filter(Boolean);

let companionPath = null;
for (const p of companionPaths) {
  if (existsSync(p)) { companionPath = p; break; }
}

if (!companionPath) {
  // codex-plugin-cc not available — allow through (fail-open)
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  process.exit(0);
}

// Run the stop review via codex-companion
try {
  const result = spawnSync(process.execPath, [companionPath, "task", "--wait", "--json",
    "Review the current session changes. If code changes have issues that need fixing, respond BLOCK: <reason>. If changes are clean or no code changes were made, respond ALLOW: <reason>."],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 600_000, // 10 minutes max
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

  const output = (result.stdout ?? "").trim();
  const firstLine = output.split(/\r?\n/)[0]?.trim() ?? "";

  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || "Codex stop-time review found issues";
    process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
  } else {
    // ALLOW or unrecognized — pass through (fail-open)
    process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
  }
} catch (err) {
  // Fail-open: if stop review fails, don't block the session
  process.stderr.write(`[stop-review-gate] error: ${err.message}\n`);
  process.stdout.write(JSON.stringify({ decision: "allow" }) + "\n");
}
