/**
 * Bootstrap service — handles daemon initialization lifecycle.
 * Extracted from daemon/index.ts to reduce entry point responsibility.
 *
 * Responsibilities:
 * - EventStore + QuorumBus creation
 * - Ring buffer recovery from SQLite
 * - Bootstrap from lightweight state markers (audit-status.json, git worktrees, RTM)
 * - Config loading
 * - Config refresh loop
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { execFileSync } from "node:child_process";
import { QuorumBus } from "../../platform/bus/bus.js";
import { EventStore } from "../../platform/bus/store.js";
import { createEvent } from "../../platform/bus/events.js";
import type { ProviderConfig } from "../../platform/providers/provider.js";

// ── Types ────────────────────────────────────────────────────────────

export interface DaemonConfig extends ProviderConfig {
  agreeTag: string;
  pendingTag: string;
}

export interface StoreResult {
  store: EventStore;
  bus: QuorumBus;
}

// ── Config Loading ───────────────────────────────────────────────────

export function loadConfig(repoRoot: string): DaemonConfig {
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
  let auditorModel = "codex";
  let triggerTag = "[REVIEW_NEEDED]";
  let agreeTag = "[APPROVED]";
  let pendingTag = "[CHANGES_REQUESTED]";
  let roles: Record<string, string> | undefined;

  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      auditorModel = cfg.plugin?.auditor_model ?? auditorModel;
      triggerTag = cfg.consensus?.trigger_tag ?? triggerTag;
      agreeTag = cfg.consensus?.agree_tag ?? agreeTag;
      pendingTag = cfg.consensus?.pending_tag ?? pendingTag;
      if (cfg.consensus?.roles && typeof cfg.consensus.roles === "object") {
        roles = cfg.consensus.roles;
      }
    } catch (err) { console.warn(`[daemon-bootstrap] config parse failed, using defaults: ${(err as Error).message}`); }
  }

  return {
    repoRoot,
    triggerTag,
    agreeTag,
    pendingTag,
    auditor: { model: auditorModel, timeout: 120_000, roles },
  };
}

// ── Store + Bus Initialization ───────────────────────────────────────

/**
 * Initialize EventStore and QuorumBus, recovering previous session events.
 */
export function initializeStore(dbPath: string, ringSize = 500): StoreResult {
  const store = new EventStore({ dbPath });
  const bus = new QuorumBus({ store, bufferSize: ringSize });

  // Recover previous session events into ring buffer
  bus.loadFromLog();

  return { store, bus };
}

// ── State Bootstrap ──────────────────────────────────────────────────

/**
 * Bootstrap: emit initial events from lightweight state markers.
 * SQLite is the single source of truth — this only bootstraps from
 * audit-status.json marker and git metadata. No watch file parsing.
 * ProcessMux manages agents — no lock files.
 */
export function bootstrapFromState(repoRoot: string, config: ProviderConfig, bus: QuorumBus): void {
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
    } catch (err) { console.warn(`[daemon-bootstrap] audit-status.json parse failed: ${(err as Error).message}`); }
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
    } catch (err) { console.warn(`[daemon-bootstrap] retro marker parse failed: ${(err as Error).message}`); }
  }

  // 3. Active worktrees — git worktree list + per-worktree audit-status.json
  bootstrapWorktrees(repoRoot, bus);

  // 4. RTM-based track progress
  bootstrapRTMProgress(repoRoot, bus);
}

/**
 * Scan git worktrees and emit agent.spawn / audit.verdict events.
 */
function bootstrapWorktrees(repoRoot: string, bus: QuorumBus): void {
  try {
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
          } catch (err) { console.warn(`[daemon-bootstrap] worktree audit-status.json parse failed: ${(err as Error).message}`); }
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
  } catch (err) { console.warn(`[daemon-bootstrap] git worktree list failed: ${(err as Error).message}`); }
}

/**
 * Scan RTM files in docs/ and plans/ and emit track.progress events.
 */
function bootstrapRTMProgress(repoRoot: string, bus: QuorumBus): void {
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
  } catch (err) { console.warn(`[daemon-bootstrap] RTM progress scan failed: ${(err as Error).message}`); }
}

function findRtmFiles(dir: string, results: string[]): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) findRtmFiles(full, results);
      else if (entry.name.startsWith("rtm") && entry.name.endsWith(".md")) results.push(full);
    }
  } catch (err) { console.warn(`[daemon-bootstrap] findRtmFiles scan failed for ${dir}: ${(err as Error).message}`); }
}

// ── Config Refresh Loop ──────────────────────────────────────────────

/**
 * Start config refresh loop.
 * Returns cleanup function to stop the interval.
 */
export async function startConfigRefresh(intervalMs = 10_000): Promise<() => void> {
  // Lazy import to avoid circular deps with MJS module
  let _refreshConfig: (() => void) | null = null;
  try {
    // Resolve to source .mjs (not dist/) — tsc doesn't copy .mjs files
    const contextPath = resolve(__dirname, "..", "..", "..", "platform", "core", "context.mjs");
    const mod = await import(contextPath);
    _refreshConfig = mod.refreshConfigIfChanged;
  } catch (err) { console.warn(`[daemon-bootstrap] config refresh module load failed: ${(err as Error).message}`); }

  const configInterval = setInterval(() => {
    try { _refreshConfig?.(); } catch (err) { console.warn(`[daemon-bootstrap] config refresh failed: ${(err as Error).message}`); }
  }, intervalMs);

  return () => clearInterval(configInterval);
}
