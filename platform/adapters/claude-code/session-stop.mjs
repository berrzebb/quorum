#!/usr/bin/env node
/**
 * Hook: Stop
 * On session end: sync handoff + auto-commit session artifacts.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncHandoffToMemory } from "./handoff-writer.mjs";
import { resolveRepoRoot } from "../shared/repo-resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = resolveRepoRoot();

// Read config — prefer CLAUDE_PLUGIN_ROOT (set by hooks.json), fallback to __dirname
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const configPath = (() => {
  if (pluginRoot) {
    const p = resolve(pluginRoot, "config.json");
    if (existsSync(p)) return p;
  }
  return resolve(__dirname, "config.json");
})();
const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const handoffFile = cfg.plugin?.handoff_file ?? ".claude/session-handoff.md";

/** Run git with args array — no shell interpolation, no injection. */
function git(args, cwd) {
  try {
    const r = spawnSync("git", args, { cwd: cwd ?? REPO_ROOT, encoding: "utf8", stdio: "pipe", windowsHide: true });
    return r.status === 0 ? (r.stdout || "").trim() : null;
  } catch (err) {
    console.warn(`[session-stop] git command failed: ${err?.message}`);
    return null;
  }
}

// 1. Sync handoff from repo to memory (plugin-internal, no external script)
const locale = cfg.plugin?.locale ?? "en";
try {
  syncHandoffToMemory(REPO_ROOT, handoffFile, { locale });
} catch (err) { console.warn(`[session-stop] handoff sync failed: ${err?.message}`); }

// 2. quorum repo: auto-commit if changes exist
const clDir = __dirname;
if (existsSync(resolve(clDir, ".git"))) {
  const status = git(["diff", "--name-only"], clDir);
  if (status) {
    git(["add", "-u"], clDir);
    const diff = git(["diff", "--cached", "--stat"], clDir) || "";
    git(["commit", "-m", `WIP: auto-commit session changes\n\n${diff}`, "--no-verify"], clDir);
    git(["push", "origin", "main"], clDir);
  }
}

// 3. Main repo: stage session artifacts only
// handoffFile is managed by memory sync (handoff-writer) — no git commit needed
const artifacts = [
  ".claude/CLAUDE.md",
];

for (const f of artifacts) {
  const fullPath = resolve(REPO_ROOT, f);
  if (existsSync(fullPath)) {
    git(["add", f]);
  }
}

const staged = git(["diff", "--cached", "--name-only"]);
if (staged) {
  const diff = git(["diff", "--cached", "--stat"]) || "";
  git(["commit", "-m", `chore: auto-commit session artifacts\n\n${diff}\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`, "--no-verify"]);
}

// ── Auto-update RTM statuses on session end ──
try {
  const { updateAllRtms } = await import("../../core/rtm-updater.mjs");
  const results = updateAllRtms(REPO_ROOT);
  if (results.length > 0) {
    const total = results.reduce((s, r) => s + r.updated, 0);
    console.error(`[quorum] RTM auto-updated: ${total} row(s)`);
  }
} catch (e) { console.error(`[quorum] RTM update warning: ${e.message}`); }

// ── Bridge: emit session.stop + retro learning + fitness snapshot ──
try {
  const bridge = await import("../../core/bridge.mjs");
  await bridge.init(REPO_ROOT);

  // 1. Record session end event
  bridge.event.emitEvent("session.stop", "claude-code", {
    sessionId: process.env.RETRO_SESSION_ID ?? null,
  });

  // 2. Stagnation detection — feed into trigger learning
  const stagnation = bridge.gate.detectStagnation?.();
  if (stagnation?.patterns?.length > 0) {
    bridge.event.emitEvent("stagnation.detected", "claude-code", {
      patterns: stagnation.patterns.map(p => p.type),
      count: stagnation.patterns.length,
    });
  }

  // 3. Fitness: record last known score (actual computation is in orchestrate governance)
  const lastFitness = bridge.event.queryEvents?.({ eventType: "fitness.check", limit: 1, descending: true })?.[0];
  if (lastFitness?.payload?.score != null) {
    bridge.event.emitEvent("fitness.snapshot", "claude-code", {
      score: lastFitness.payload.score, phase: "session-end",
    });
  }

  // 4. Auto-learn: analyze audit history → suggest rules
  const learnings = bridge.execution.analyzeAuditLearnings?.();
  if (learnings?.suggestions?.length > 0) {
    bridge.event.emitEvent("learning.suggestions", "claude-code", {
      count: learnings.suggestions.length,
      suggestions: learnings.suggestions.slice(0, 5),
    });
    console.error(`[quorum] Auto-learn: ${learnings.suggestions.length} rule suggestion(s) from audit history`);
  }

  // 5. [FACT WB-4] Extract facts from session events
  try {
    const { extractFacts } = await import("../../adapters/shared/fact-extractor.mjs");
    const sessionEvents = bridge.event.queryEvents({ limit: 100, descending: true });
    const factCandidates = extractFacts(sessionEvents);
    for (const fc of factCandidates) {
      bridge.fact.addFact(fc);
    }
    if (factCandidates.length > 0) {
      console.error(`[quorum] Fact extraction: ${factCandidates.length} candidate(s) from session events`);
    }
  } catch (e) { console.error(`[quorum] Fact extraction warning: ${e?.message}`); }

  bridge.close();
} catch (e) { console.error(`[quorum] Bridge session-stop warning: ${e.message}`); }
