#!/usr/bin/env node
/**
 * Quorum Daemon — persistent TUI process that orchestrates the audit cycle.
 *
 * Starts the event bus, connects providers, and renders the Ink dashboard.
 * Can be invoked directly or via `quorum daemon`.
 */

import { resolve } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { platform } from "node:os";
import React from "react";
import { render } from "ink";
import { QuorumBus } from "../bus/bus.js";
import { EventStore } from "../bus/store.js";
import { LockService } from "../bus/lock.js";
import { createEvent } from "../bus/events.js";
import { ClaudeCodeProvider } from "../providers/claude-code/adapter.js";
import { registerProvider, listProviders } from "../providers/provider.js";
import type { ProviderConfig } from "../providers/provider.js";
import { ProcessMux, ensureMuxBackend } from "../bus/mux.js";
import { StateReader } from "./state-reader.js";
import { App } from "./app.js";

const DASHBOARD_SESSION = "quorum-dashboard";

function loadConfig(repoRoot: string): ProviderConfig {
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
  let watchFile = "docs/feedback/claude.md";
  let respondFile = "docs/feedback/gpt.md";
  let auditorModel = "codex";
  let triggerTag = "[REVIEW_NEEDED]";

  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      watchFile = cfg.consensus?.watch_file ?? watchFile;
      respondFile = cfg.plugin?.respond_file
        ? watchFile.replace(/[^/]+$/, cfg.plugin.respond_file)
        : respondFile;
      auditorModel = cfg.plugin?.auditor_model ?? auditorModel;
      triggerTag = cfg.consensus?.trigger_tag ?? triggerTag;
    } catch { /* use defaults */ }
  }

  return {
    repoRoot,
    watchFile,
    respondFile,
    triggerTag,
    auditor: { model: auditorModel, timeout: 120_000 },
  };
}

export default async function startDaemon(): Promise<void> {
  const repoRoot = process.cwd();

  // ── Mux session wrapper ──
  // If a mux backend is available and we're NOT already inside a session,
  // create a mux session and re-launch the daemon inside it.
  // This enables remote attach/capture via `quorum status --attach`.
  if (!process.env.QUORUM_IN_MUX_SESSION) {
    const backend = await ensureMuxBackend();
    if (backend !== "raw") {
      const inSession = (backend === "tmux" && process.env.TMUX)
        || (backend === "psmux" && process.env.PSMUX_SESSION);

      if (!inSession) {
        const mux = new ProcessMux(backend);
        try {
          await mux.spawn({
            name: DASHBOARD_SESSION,
            command: process.execPath,
            args: [resolve(__dirname, "index.js")],
            cwd: repoRoot,
            env: { QUORUM_IN_MUX_SESSION: "1" },
          });
          console.log(`Dashboard running in ${backend} session: ${DASHBOARD_SESSION}`);
          console.log(`Attach: ${backend === "tmux" ? "tmux attach -t" : "psmux attach"} ${DASHBOARD_SESSION}`);
          return;
        } catch {
          // Mux spawn failed — fall through to direct TUI rendering
          console.log("Mux session creation failed — running TUI directly.");
        }
      }
    }
  }

  // Initialize SQLite event store + bus
  const dbPath = resolve(repoRoot, ".claude", "quorum-events.db");
  const store = new EventStore({ dbPath });
  const bus = new QuorumBus({ store, bufferSize: 500 });

  // Recover previous session events into ring buffer
  bus.loadFromLog();

  // Load config
  const config = loadConfig(repoRoot);

  // Register and start providers
  const claude = new ClaudeCodeProvider();
  registerProvider(claude);
  await claude.start(bus, config);

  // StateReader for SQLite-only state queries (new panels)
  const stateReader = new StateReader(store);

  // Bootstrap: only scan files if SQLite has no prior events.
  // When SQLite has data (normal operation), StateReader handles everything.
  const hasExistingData = store.query({ limit: 1 }).length > 0;
  if (!hasExistingData) {
    bootstrapFromFiles(repoRoot, config, bus);
  }
  const lockService = new LockService(store.getDb());

  // Periodic maintenance: clean expired locks
  const maintenanceInterval = setInterval(() => {
    try { lockService.cleanExpired(); } catch { /* non-critical */ }
  }, 10_000);

  // Config refresh (lazy import to avoid circular deps with MJS module)
  setInterval(async () => {
    try {
      const { refreshConfigIfChanged } = await import("../core/context.mjs" as any);
      refreshConfigIfChanged();
    } catch { /* non-critical */ }
  }, 10_000);

  // Render TUI with stateReader
  const { waitUntilExit } = render(
    React.createElement(App, { bus, stateReader }),
  );

  // Graceful shutdown
  await waitUntilExit();
  clearInterval(maintenanceInterval);
  for (const provider of listProviders()) {
    await provider.stop();
  }
  store.close();
}

/**
 * Bootstrap: scan existing file state and emit initial events.
 * This populates the TUI with the current state of the project,
 * not just events that happen after daemon starts.
 */
function bootstrapFromFiles(repoRoot: string, config: ProviderConfig, bus: QuorumBus): void {
  // 1. Evidence file — pending/approved/rejected items
  const watchPath = resolve(repoRoot, config.watchFile);
  if (existsSync(watchPath)) {
    const content = readFileSync(watchPath, "utf8");
    const pending = (content.match(/\[REVIEW_NEEDED\]/g) ?? []).length;
    const approved = (content.match(/\[APPROVED\]/g) ?? []).length;
    const rejected = (content.match(/\[CHANGES_REQUESTED\]/g) ?? []).length;

    if (pending > 0) {
      bus.emit(createEvent("audit.submit", "claude-code", {
        file: watchPath,
        pending,
        bootstrap: true,
      }));
    }
    if (approved > 0) {
      bus.emit(createEvent("audit.verdict", "claude-code", {
        verdict: "approved",
        count: approved,
        bootstrap: true,
      }));
    }
    if (rejected > 0) {
      bus.emit(createEvent("audit.verdict", "claude-code", {
        verdict: "changes_requested",
        count: rejected,
        bootstrap: true,
      }));
    }
    const infraFailures = (content.match(/\[INFRA_FAILURE\]/g) ?? []).length;
    if (infraFailures > 0) {
      bus.emit(createEvent("audit.verdict", "claude-code", {
        verdict: "infra_failure",
        count: infraFailures,
        bootstrap: true,
      }));
    }
  }

  // 2. Audit lock — active audit
  const lockPath = resolve(repoRoot, ".claude", "audit.lock");
  if (existsSync(lockPath)) {
    bus.emit(createEvent("audit.start", "claude-code", { bootstrap: true }));
  }

  // 3. Retro marker — gate status
  const markerPath = resolve(repoRoot, ".session-state", "retro-marker.json");
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      bus.emit(createEvent("retro.start", "claude-code", {
        sessionId: marker.session_id,
        bootstrap: true,
      }));
    } catch { /* skip */ }
  }

  // 4. Audit history JSONL — import recent verdicts for stagnation detection
  const historyPath = resolve(repoRoot, ".claude", "audit-history.jsonl");
  if (existsSync(historyPath)) {
    const lines = readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean);
    const recent = lines.slice(-10); // last 10 for stagnation context
    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        bus.emit(createEvent("audit.verdict", "claude-code", {
          verdict: entry.verdict === "agree" ? "approved" : "changes_requested",
          codes: entry.rejection_codes ?? [],
          track: entry.track ?? "",
          bootstrap: true,
        }));
      } catch { /* skip */ }
    }
  }

  // 5. Active agents — from .claude/agents/*.json (written by quorum agent spawn)
  //    Clean up zombie state files (process no longer running)
  try {
    const agentsDir = resolve(repoRoot, ".claude", "agents");
    if (existsSync(agentsDir)) {
      const { rmSync } = require("node:fs") as typeof import("node:fs");
      for (const f of readdirSync(agentsDir)) {
        if (!f.endsWith(".json")) continue;
        try {
          const agentPath = resolve(agentsDir, f);
          const agent = JSON.parse(readFileSync(agentPath, "utf8"));

          // Check if PID is still alive
          let alive = false;
          if (agent.pid) {
            try { process.kill(agent.pid, 0); alive = true; } catch { /* dead */ }
          }

          if (alive) {
            bus.emit(createEvent("agent.spawn", "claude-code", {
              name: agent.name ?? f.replace(".json", ""),
              role: agent.role ?? "worker",
              pid: agent.pid,
              backend: agent.backend,
              bootstrap: true,
            }));
          } else {
            // Zombie — remove stale state file
            rmSync(agentPath, { force: true });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  // 6. Active worktrees — git worktree list + evidence + commit history
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const wtOutput = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });

    let wtPath = "";
    for (const line of wtOutput.split("\n")) {
      if (line.startsWith("worktree ")) {
        wtPath = line.slice(9).trim();
      } else if (line.startsWith("branch ") && wtPath && wtPath !== repoRoot) {
        const branch = line.slice(7).trim().replace("refs/heads/", "");

        // Read evidence from this worktree
        let trackName = branch;
        let evidenceStatus: "pending" | "approved" | "rejected" | "infra_failure" = "pending";
        const wtWatchPath = resolve(wtPath, config.watchFile);
        if (existsSync(wtWatchPath)) {
          const content = readFileSync(wtWatchPath, "utf8");
          const heading = content.match(/^##\s+\[([^\]]+)\]\s+(.*)/m);
          if (heading) {
            const tag = heading[1]!;
            trackName = heading[2]!.trim();
            if (tag === "APPROVED") evidenceStatus = "approved";
            else if (tag === "CHANGES_REQUESTED") evidenceStatus = "rejected";
            else if (tag === "INFRA_FAILURE") evidenceStatus = "infra_failure";
          }
        }

        // Agent event
        bus.emit(createEvent("agent.spawn", "claude-code", {
          name: branch,
          role: "implementer",
          worktree: wtPath,
          track: trackName,
          bootstrap: true,
        }));

        // Evidence event for this worktree
        if (evidenceStatus !== "pending") {
          bus.emit(createEvent("audit.verdict", "claude-code", {
            verdict: evidenceStatus === "approved" ? "approved" : evidenceStatus === "infra_failure" ? "infra_failure" : "changes_requested",
            track: trackName,
            worktree: wtPath,
            bootstrap: true,
          }));
        }

        wtPath = "";
      }
    }
  } catch { /* git worktree not available */ }

  // 7. Git commit history → track progress
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const log = execFileSync("git", ["log", "--oneline", "-10"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    });
    for (const line of log.trim().split("\n").filter(Boolean)) {
      bus.emit(createEvent("evidence.sync", "claude-code", {
        commit: line,
        bootstrap: true,
      }));
    }
  } catch { /* skip */ }

  // 8. RTM-based track progress
  try {
    const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];
    const rtmFiles: string[] = [];
    for (const dir of searchDirs) {
      if (!existsSync(dir)) continue;
      findRtmFiles(dir, rtmFiles);
    }

    for (const rtmPath of rtmFiles) {
      const content = readFileSync(rtmPath, "utf8");
      let currentTrack = "";
      let total = 0, verified = 0, wip = 0;

      for (const line of content.split(/\r?\n/)) {
        const trackMatch = line.match(/^##\s+(\w+)\s+Track/i);
        if (trackMatch) {
          // Emit previous track
          if (currentTrack && total > 0) {
            bus.emit(createEvent("track.progress", "claude-code", {
              trackId: currentTrack,
              total, completed: verified, pending: total - verified - wip, blocked: 0,
              bootstrap: true,
            }));
          }
          currentTrack = trackMatch[1]!;
          total = 0; verified = 0; wip = 0;
          continue;
        }

        if (!line.startsWith("|") || line.includes("---")) continue;
        const cells = line.split("|").map((c: string) => c.trim()).filter(Boolean);
        if (cells.length < 2 || !/^[A-Z]{2,}-\d+/.test(cells[0]!)) continue;

        const status = cells[cells.length - 1]!.toLowerCase();
        total++;
        if (status === "verified") verified++;
        else if (status === "wip" || status.startsWith("partial")) wip++;
      }

      // Emit last track
      if (currentTrack && total > 0) {
        bus.emit(createEvent("track.progress", "claude-code", {
          trackId: currentTrack,
          total, completed: verified, pending: total - verified - wip, blocked: 0,
          bootstrap: true,
        }));
      }
    }
  } catch { /* skip */ }
}

function findRtmFiles(dir: string, results: string[]): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) findRtmFiles(full, results);
      else if (entry.name.startsWith("rtm") && entry.name.endsWith(".md")) results.push(full);
    }
  } catch { /* skip */ }
}

// Direct invocation: node daemon/index.ts
const isDirectRun = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`;
if (isDirectRun) {
  startDaemon().catch((err) => {
    console.error("Daemon failed to start:", err);
    process.exit(1);
  });
}
