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
import { createEvent } from "../bus/events.js";
import { ClaudeCodeProvider } from "../providers/claude-code/adapter.js";
import { registerProvider, listProviders } from "../providers/provider.js";
import type { ProviderConfig } from "../providers/provider.js";
import { ProcessMux, ensureMuxBackend } from "../bus/mux.js";
import { MarkdownProjector } from "../bus/projector.js";
import { MessageBus } from "../bus/message-bus.js";
import { StateReader } from "./state-reader.js";
import { App } from "./app.js";

const DASHBOARD_SESSION = "quorum-dashboard";

interface DaemonConfig extends ProviderConfig {
  agreeTag: string;
  pendingTag: string;
}

function loadConfig(repoRoot: string): DaemonConfig {
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
  let watchFile = "docs/feedback/claude.md";
  let auditorModel = "codex";
  let triggerTag = "[REVIEW_NEEDED]";
  let agreeTag = "[APPROVED]";
  let pendingTag = "[CHANGES_REQUESTED]";
  let roles: Record<string, string> | undefined;

  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      watchFile = cfg.consensus?.watch_file ?? watchFile;
      auditorModel = cfg.plugin?.auditor_model ?? auditorModel;
      triggerTag = cfg.consensus?.trigger_tag ?? triggerTag;
      agreeTag = cfg.consensus?.agree_tag ?? agreeTag;
      pendingTag = cfg.consensus?.pending_tag ?? pendingTag;
      if (cfg.consensus?.roles && typeof cfg.consensus.roles === "object") {
        roles = cfg.consensus.roles;
      }
    } catch { /* use defaults */ }
  }

  return {
    repoRoot,
    watchFile,
    triggerTag,
    agreeTag,
    pendingTag,
    auditor: { model: auditorModel, timeout: 120_000, roles },
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

  // MessageBus + StateReader for finding-level queries
  const messageBus = new MessageBus(store);
  const stateReader = new StateReader(store, messageBus);

  // Projector for self-healing markdown ↔ SQLite drift
  const projector = new MarkdownProjector(store.getDb(), {
    triggerTag: config.triggerTag ?? "[REVIEW_NEEDED]",
    agreeTag: config.agreeTag,
    pendingTag: config.pendingTag,
  });
  const watchPath = resolve(repoRoot, config.watchFile);
  // selfHeal runs only when new events exist since last check (avoids no-op cycles)
  let lastSelfHealTimestamp = 0;
  const selfHealInterval = setInterval(() => {
    try {
      const latest = store.recent(1);
      const latestTs = latest[0]?.timestamp ?? 0;
      if (latestTs === lastSelfHealTimestamp) return;
      lastSelfHealTimestamp = latestTs;

      const diffs = projector.selfHeal(watchPath);
      if (diffs.length > 0) {
        bus.emit(createEvent("evidence.sync", "claude-code", {
          staleDiffs: diffs.length,
          selfHeal: true,
        }));
      }
    } catch { /* non-critical */ }
  }, 30_000);

  // Bootstrap: only scan minimal state if SQLite has no prior events.
  // When SQLite has data (normal operation), StateReader handles everything.
  const hasExistingData = store.query({ limit: 1 }).length > 0;
  if (!hasExistingData) {
    bootstrapFromState(repoRoot, config, bus);
  }

  // Config refresh (lazy import to avoid circular deps with MJS module)
  let _refreshConfig: (() => void) | null = null;
  try {
    const mod = await import("../core/context.mjs" as any);
    _refreshConfig = mod.refreshConfigIfChanged;
  } catch { /* non-critical */ }
  const configInterval = setInterval(() => {
    try { _refreshConfig?.(); } catch { /* non-critical */ }
  }, 10_000);

  // Render TUI with stateReader
  const { waitUntilExit } = render(
    React.createElement(App, { bus, stateReader }),
  );

  // Graceful shutdown
  await waitUntilExit();
  clearInterval(configInterval);
  clearInterval(selfHealInterval);
  for (const provider of listProviders()) {
    await provider.stop();
  }
  store.close();
}

/**
 * Bootstrap: emit initial events from lightweight state markers.
 * SQLite is the single source of truth — this only bootstraps from
 * audit-status.json marker and git metadata. No watch file parsing.
 * ProcessMux manages agents — no lock files.
 */
function bootstrapFromState(repoRoot: string, config: ProviderConfig, bus: QuorumBus): void {
  // 1. audit-status.json marker — last known verdict state
  const statusPath = resolve(repoRoot, ".claude", "audit-status.json");
  if (existsSync(statusPath)) {
    try {
      const status = JSON.parse(readFileSync(statusPath, "utf8"));
      bus.emit(createEvent("audit.verdict", "claude-code", {
        verdict: status.status ?? "unknown",
        pendingCount: status.pendingCount ?? 0,
        codes: status.rejectionCodes ?? [],
        bootstrap: true,
      }));
    } catch { /* skip */ }
  }

  // 2. Retro marker — gate status
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

  // 3. Active worktrees — git worktree list + per-worktree audit-status.json
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

        // Read audit-status.json from worktree (no watch file parsing)
        let trackName = branch;
        let verdictStatus = "pending";
        const wtStatusPath = resolve(wtPath, ".claude", "audit-status.json");
        if (existsSync(wtStatusPath)) {
          try {
            const ws = JSON.parse(readFileSync(wtStatusPath, "utf8"));
            verdictStatus = ws.status ?? "pending";
            if (ws.track) trackName = ws.track;
          } catch { /* skip */ }
        }

        bus.emit(createEvent("agent.spawn", "claude-code", {
          name: branch,
          role: "implementer",
          worktree: wtPath,
          track: trackName,
          bootstrap: true,
        }));

        if (verdictStatus !== "pending") {
          bus.emit(createEvent("audit.verdict", "claude-code", {
            verdict: verdictStatus,
            track: trackName,
            worktree: wtPath,
            bootstrap: true,
          }));
        }

        wtPath = "";
      }
    }
  } catch { /* git worktree not available */ }

  // 4. RTM-based track progress
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
