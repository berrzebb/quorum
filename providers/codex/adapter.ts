/**
 * Codex Provider — bridges OpenAI Codex CLI to the quorum bus.
 *
 * Codex has no native hooks. Event detection uses:
 * 1. File watching: evidence file + .codex/ state directory
 * 2. Process monitoring: codex PID tracking
 * 3. tmux pane capture: for team orchestration (optional)
 *
 * Model lanes (OMX pattern):
 *   CODEX_MODEL / OMX_DEFAULT_FRONTIER_MODEL / OMX_DEFAULT_STANDARD_MODEL
 */

import { existsSync, readFileSync, statSync, watchFile, unwatchFile, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { QuorumBus } from "../../bus/bus.js";
import { createEvent } from "../../bus/events.js";
import type {
  QuorumProvider,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
} from "../provider.js";

export class CodexProvider implements QuorumProvider {
  readonly kind = "codex" as const;
  readonly displayName = "Codex";
  readonly capabilities: ProviderCapability[] = [
    "file-watch",
    "audit",
    "agent-spawn",
  ];

  private bus: QuorumBus | null = null;
  private config: ProviderConfig | null = null;
  private intervals: ReturnType<typeof setInterval>[] = [];
  private lastEventTime = 0;
  private activeAgentCount = 0;
  private pendingAuditCount = 0;
  private lastError: string | undefined;

  async start(bus: QuorumBus, config: ProviderConfig): Promise<void> {
    this.bus = bus;
    this.config = config;

    const watchPath = resolve(config.repoRoot, config.watchFile);
    const stateDir = resolve(config.repoRoot, ".codex");

    // Ensure state directory exists
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    // Watch evidence file for trigger tags
    this.watchEvidence(watchPath);

    // Poll .codex/ state for agent activity
    this.pollAgentState(stateDir);

    this.bus.emit(createEvent("session.start", "codex", {
      mode: "file-watch",
      stateDir,
    }));
  }

  async stop(): Promise<void> {
    for (const id of this.intervals) {
      clearInterval(id);
    }
    this.intervals = [];

    if (this.config) {
      const watchPath = resolve(this.config.repoRoot, this.config.watchFile);
      unwatchFile(watchPath);
    }

    this.bus = null;
    this.config = null;
  }

  status(): ProviderStatus {
    return {
      connected: this.bus !== null,
      lastEvent: this.lastEventTime || undefined,
      activeAgents: this.activeAgentCount,
      pendingAudits: this.pendingAuditCount,
      error: this.lastError,
    };
  }

  // ── Codex availability check ──────────────────

  static isAvailable(): boolean {
    try {
      const bin = process.env.CODEX_BIN ?? "codex";
      const result = spawnSync(bin, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  // ── Internal watchers ─────────────────────────

  private watchEvidence(watchPath: string): void {
    if (!existsSync(watchPath)) return;

    let lastMtime = statSync(watchPath).mtimeMs;

    watchFile(watchPath, { interval: 2000 }, (curr) => {
      if (curr.mtimeMs <= lastMtime || !this.bus) return;
      lastMtime = curr.mtimeMs;

      const content = readFileSync(watchPath, "utf8");

      // Detect trigger tags
      if (content.includes("[REVIEW_NEEDED]")) {
        this.pendingAuditCount++;
        this.bus.emit(createEvent("audit.submit", "codex", {
          file: watchPath,
        }));
        this.lastEventTime = Date.now();
      }

      // Detect approval (from another auditor writing to the file)
      if (content.includes("[APPROVED]")) {
        this.bus.emit(createEvent("evidence.sync", "codex", {
          file: watchPath,
          hasApproval: true,
        }));
        this.lastEventTime = Date.now();
      }
    });
  }

  private pollAgentState(stateDir: string): void {
    const agentLog = resolve(stateDir, "agents.jsonl");
    let lastSize = existsSync(agentLog) ? statSync(agentLog).size : 0;

    this.intervals.push(setInterval(() => {
      if (!this.bus || !existsSync(agentLog)) return;

      const currentSize = statSync(agentLog).size;
      if (currentSize <= lastSize) return;

      // Read new lines
      const content = readFileSync(agentLog, "utf8");
      const lines = content.trim().split("\n");
      const newLines = lines.slice(-Math.max(1, Math.ceil((currentSize - lastSize) / 100)));

      for (const line of newLines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "spawn") {
            this.activeAgentCount++;
            this.bus.emit(createEvent("agent.spawn", "codex", {
              name: entry.name,
              role: entry.role ?? "executor",
              model: entry.model,
            }));
          } else if (entry.type === "complete") {
            this.activeAgentCount = Math.max(0, this.activeAgentCount - 1);
            this.bus.emit(createEvent("agent.complete", "codex", {
              name: entry.name,
            }));
          }
          this.lastEventTime = Date.now();
        } catch {
          // Skip malformed lines
        }
      }

      lastSize = currentSize;
    }, 2000));
  }
}
