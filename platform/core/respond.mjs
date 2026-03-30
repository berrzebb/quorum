#!/usr/bin/env node
/* global process, console */

/**
 * Event Reactor — reads verdict from SQLite EventStore and executes side-effects.
 *
 * Replaces the legacy markdown-manipulation respond.mjs.
 * All state lives in SQLite. Markdown files are no longer read or written.
 *
 * Side-effects:
 *   1. Auto-fix: spawn claude -p for changes_requested items
 *   2. Retro: trigger retrospective when all items approved
 *   3. Explain gate: block retro until explanation provided
 *   4. Stagnation: detect + escalate / force-approve
 *   5. Router: record verdict for tier escalation/downgrade
 *   6. Tech debt: capture residual risk on approval
 */

import { resolve } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveBinary, spawnResolved } from "./cli-runner.mjs";
import * as bridge from "./bridge.mjs";
import {
  HOOKS_DIR, REPO_ROOT, cfg, plugin, consensus, safeLocale, t,
  resolvePluginPath, resolveReferencesDir,
} from "./context.mjs";

// ── Args ──────────────────────────────────────

function parseArgs(argv) {
  const args = { autoFix: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--auto-fix") args.autoFix = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: node respond.mjs [--auto-fix] [--dry-run]");
      process.exit(0);
    }
  }
  return args;
}

// ── Verdict Reader ────────────────────────────

/**
 * Read the latest unprocessed verdict from EventStore.
 * Returns { verdict, codes, agreedIds, pendingIds, track } or null.
 */
function readLatestVerdict() {
  const lastProcessed = bridge.getState?.("respond:last_processed");
  const since = lastProcessed?.timestamp ?? 0;

  const events = bridge.queryEvents({ eventType: "audit.verdict", since, limit: 1 });
  if (!events || events.length === 0) return null;

  const e = events[0];
  const p = e.payload ?? {};
  return {
    timestamp: e.timestamp,
    verdict: p.verdict ?? "unknown",
    codes: p.codes ?? [],
    agreedCount: p.agreedCount ?? 0,
    pendingCount: p.pendingCount ?? 0,
    track: p.summary ?? "",
    sessionId: e.sessionId ?? "",
  };
}

/**
 * Read current item states from state_transitions table.
 */
function readItemStates() {
  const items = bridge.queryItemStates();
  if (!items || items.length === 0) return { pending: [], approved: [], all: [] };

  const pending = items.filter(i => i.currentState === "changes_requested");
  const approved = items.filter(i => i.currentState === "approved");
  return { pending, approved, all: items };
}

// ── Side-Effects ──────────────────────────────

function runAutoFix(codes) {
  const fixPromptPath = resolvePluginPath(cfg.plugin.fix_prompt);
  if (!existsSync(fixPromptPath)) {
    console.log("[respond] Fix prompt template not found, skipping auto-fix");
    return;
  }

  const template = readFileSync(fixPromptPath, "utf8");

  // Read latest verdict text from SQLite for auto-fix context
  let verdictText = "";
  try {
    const events = bridge.queryEvents({ eventType: "audit.verdict", limit: 1 });
    verdictText = events?.[0]?.payload?.verdictText ?? "";
  } catch (err) { console.warn("[respond] verdict text read failed:", err?.message ?? err); }

  const prompt = template
    .replace(/\{\{CORRECTIONS\}\}/g, codes.map(c => `- ${c}`).join("\n"))
    .replace(/\{\{REJECT_CODES\}\}/g, codes.join(", "))
    .replace(/\{\{RESET_CRITERIA\}\}/g, codes.join(", "))
    .replace(/\{\{NEXT_TASKS\}\}/g, "")
    .replace(/\{\{VERDICT_TEXT\}\}/g, verdictText)
    .replace(/\{\{TRIGGER_TAG\}\}/g, consensus.trigger_tag)
    .replace(/\{\{AGREE_TAG\}\}/g, consensus.agree_tag)
    .replace(/\{\{PENDING_TAG\}\}/g, consensus.pending_tag)
    .replace(/\{\{LOCALE\}\}/g, safeLocale)
    .replace(/\{\{DESIGN_DOCS_DIR\}\}/g, consensus.design_docs_dir ?? "")
    .replace(/\{\{REFERENCES_DIR\}\}/g, resolveReferencesDir(safeLocale).replace(/\\/g, "/"));

  console.log("[respond] Invoking claude for auto-fix...");
  const result = spawnResolved(resolveBinary("claude", "CLAUDE_BIN"), ["-p"], {
    cwd: REPO_ROOT,
    input: prompt,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, FEEDBACK_LOOP_ACTIVE: "1" },
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runRetrospective(sessionId) {
  const retroScript = cfg.plugin.retro_script;
  if (!retroScript) {
    console.log("[respond] No retro_script configured, skipping retrospective");
    return;
  }

  const retroScriptPath = resolvePluginPath(retroScript);
  if (!existsSync(retroScriptPath)) {
    console.log(`[respond] Retro script not found: ${retroScriptPath}`);
    return;
  }

  console.log("[respond] All items approved — triggering retrospective");
  spawnResolved(process.execPath, [retroScriptPath], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    encoding: "utf8",
  });
}

function checkExplainGate() {
  try {
    const explainState = bridge.getState?.("explain:pending");
    if (explainState?.required) {
      console.log("[explain-gate] Retro blocked — add explanation to evidence first");
      return true; // blocked
    }
  } catch (err) { console.warn("[respond] checkExplainGate failed:", err?.message ?? err); }
  return false;
}

function handleStagnation(track) {
  try {
    const stagnation = bridge.detectStagnation(REPO_ROOT);
    if (!stagnation?.detected) return;

    const patterns = stagnation.patterns.map(p => p.type).join(", ");
    console.log(`[respond] Stagnation detected: ${patterns} → ${stagnation.recommendation}`);

    if (stagnation.recommendation === "halt") {
      console.log("[respond] Stagnation halt — forcing approval to unblock agent");
      // Force-approve via state transition (no markdown needed)
      const { all } = readItemStates();
      for (const item of all) {
        if (item.currentState === "review_needed" || item.currentState === "changes_requested") {
          bridge.recordTransition(
            "audit_item", item.entityId,
            item.currentState, "approved",
            "system",
            { reason: "stagnation_halt", patterns },
          );
        }
      }
      bridge.emitEvent("stagnation.resolve", "system", { action: "force_approve", track });
    }
  } catch (err) { console.warn("[respond] handleStagnation failed:", err?.message ?? err); }
}

async function handleTechDebt(track) {
  try {
    const { parseResidualRisk, appendTechDebt } = await import("./enforcement.mjs");
    // Read evidence from the latest evidence.submit event
    const evidenceEvents = bridge.queryEvents({ eventType: "evidence.submit", limit: 1 });
    if (!evidenceEvents?.length) return;

    const content = evidenceEvents[0].payload?.content ?? "";
    const risks = parseResidualRisk(content);
    if (risks.length === 0) return;

    const planDirs = (consensus.planning_dirs ?? []).map(d => resolve(REPO_ROOT, d.replace(/^\/+/, "")));
    for (const dir of planDirs) {
      // Search both project-level and track-level work-catalog.md
      const candidates = [resolve(dir, "work-catalog.md")];
      try {
        for (const sub of readdirSync(dir, { withFileTypes: true })) {
          if (sub.isDirectory()) {
            const p = resolve(dir, sub.name, "work-catalog.md");
            if (existsSync(p)) candidates.push(p);
          }
        }
      } catch (err) { console.warn("[respond] handleTechDebt scandir failed:", err?.message ?? err); }
      for (const catalogPath of candidates) {
        if (existsSync(catalogPath)) {
          const appended = appendTechDebt(catalogPath, risks, track);
          if (appended > 0) {
            console.log(`[respond] Auto-registered ${appended} tech debt item(s) → ${catalogPath}`);
          }
          break;
        }
      }
    }
  } catch (err) { console.warn("[respond] handleTechDebt failed:", err?.message ?? err); }
}

// ── Main ──────────────────────────────────────

export async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Initialize bridge (connects to SQLite EventStore)
  const bridgeReady = await bridge.init(REPO_ROOT);
  if (!bridgeReady) {
    console.log("[respond] Bridge unavailable — cannot process events");
    return;
  }

  // Read latest unprocessed verdict
  const verdict = readLatestVerdict();
  if (!verdict) {
    console.log("[respond] No unprocessed verdict events");
    return;
  }

  console.log(`[respond] Processing verdict: ${verdict.verdict} (agreed=${verdict.agreedCount}, pending=${verdict.pendingCount})`);

  // Record router feedback for tier escalation
  try {
    const taskKey = verdict.track || "default";
    const escalation = bridge.recordVerdict(taskKey, verdict.verdict === "approved");
    if (escalation?.escalated) {
      console.log(`[respond] Router escalated ${taskKey} → tier ${escalation.tier}`);
    }
  } catch (err) { console.warn("[respond] recordVerdict failed:", err?.message ?? err); }

  // Branch on verdict
  if (verdict.verdict === "changes_requested") {
    console.log(`[respond] ${verdict.pendingCount} item(s) rejected, codes: ${verdict.codes.join(", ") || "none"}`);

    // Stagnation check
    handleStagnation(verdict.track);

    // Auto-fix
    if (args.autoFix && verdict.codes.length > 0) {
      if (!args.dryRun) {
        runAutoFix(verdict.codes);
      } else {
        console.log("[respond] dry-run: would invoke auto-fix");
      }
    }
  } else if (verdict.verdict === "approved") {
    console.log(`[respond] ${verdict.agreedCount} item(s) approved`);

    // Check if ALL items are now approved
    const { pending, all } = readItemStates();
    const allApproved = all.length > 0 && pending.length === 0;

    if (allApproved) {
      // Explain gate
      const blocked = checkExplainGate();

      if (!blocked && !args.dryRun) {
        runRetrospective(verdict.sessionId);
      }

      // Tech debt capture
      if (!args.dryRun) {
        await handleTechDebt(verdict.track);
      }
    } else {
      console.log(`[respond] ${pending.length} item(s) still pending — retro deferred`);
    }
  }

  // Mark verdict as processed
  if (!args.dryRun) {
    bridge.setState("respond:last_processed", {
      timestamp: verdict.timestamp,
      processedAt: Date.now(),
    });
  }

  bridge.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`respond failed: ${message}`);
    process.exit(1);
  });
}
