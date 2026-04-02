#!/usr/bin/env node
/* global process, Buffer */

/**
 * SubagentStart hook: inject protocol context into implementer/scout agents.
 *
 * Provides runtime audit state, track context, and diff basis information
 * so agents start with current situational awareness instead of static .md files only.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Read stdin ───────────────────────────────────────────────
let input;
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) process.exit(0);
  input = JSON.parse(raw);
} catch (err) {
  console.warn(`[subagent-start] stdin parse error: ${err?.message}`);
  process.exit(0);
}

const agentType = input.agent_type || "";

// Only inject for implementer and scout agents
if (!["implementer", "scout"].includes(agentType)) {
  process.exit(0);
}

// ── Gather runtime context ───────────────────────────────────
const contextParts = [];

// 1. Current audit state (from retro-marker)
try {
  const markerPath = resolve(__dirname, ".session-state", "retro-marker.json");
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (marker.retro_pending) {
      contextParts.push(`⚠️ Retrospective is pending. Agreed items: ${marker.agreed_items || "none"}`);
    }
  }
} catch (err) { console.warn(`[subagent-start] marker read error: ${err?.message}`); }

// 2. Audit status
try {
  const { REPO_ROOT } = await import("../../core/context.mjs");
  const { readAuditStatus } = await import("../../adapters/shared/audit-state.mjs");

  const status = readAuditStatus(REPO_ROOT);
  if (status) {
    contextParts.push(`📋 Current audit status: ${status.status ?? "unknown"} (pending: ${status.pendingCount ?? 0})`);
  }

  // 3. Handoff state (active tracks)
  const handoffPath = resolve(REPO_ROOT, ".claude", "session-handoff.md");
  if (existsSync(handoffPath)) {
    const handoff = readFileSync(handoffPath, "utf8");
    const inProgress = [];
    for (const line of handoff.split(/\r?\n/)) {
      if (line.includes("진행 중") || line.includes("in-progress")) {
        inProgress.push(line.trim());
      }
    }
    if (inProgress.length > 0) {
      contextParts.push(`🔄 Active tracks:\n${inProgress.join("\n")}`);
    }
  }
} catch (err) { console.warn(`[subagent-start] context import error: ${err?.message}`); }

// 5. CC-2 diff basis reminder
contextParts.push(
  `📌 CC-2 Protocol: When writing evidence, always include a diff basis commit range ` +
  `(e.g. \`git diff --name-only <base>..<head>\`). The auditor uses this range to verify scope.`
);

// ── Emit agent.spawn event to EventStore for daemon visibility ──
try {
  const bridge = await import("../../core/bridge.mjs");
  const { REPO_ROOT } = await import("../../core/context.mjs");
  await bridge.init(REPO_ROOT);
  bridge.event.emitEvent("agent.spawn", "claude-code", {
    name: input.agent_name || agentType,
    role: agentType,
    sessionId: input.session_id,
  });
  bridge.close();
} catch (err) { console.warn(`[subagent-start] bridge event emit failed: ${err?.message}`); }

// ── Output additional context ─────────────────────────────────
if (contextParts.length > 0) {
  const context = contextParts.join("\n\n");
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: `<CONSENSUS-LOOP-CONTEXT>\n${context}\n</CONSENSUS-LOOP-CONTEXT>`
    }
  });
  process.stdout.write(output);
}

process.exit(0);
