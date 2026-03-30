/**
 * Claude Code Provider — bridges existing hook system to the quorum bus.
 *
 * Claude Code has 12 native hooks that produce events.
 * This adapter listens for hook output (via IPC/file) and normalizes to QuorumEvents.
 *
 * Two modes:
 * 1. Hook-forwarding: hooks write events to a JSONL inbox, adapter polls and emits
 * 2. Standalone: adapter watches files directly (for when hooks aren't installed)
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { QuorumBus } from "../../bus/bus.js";
import { createEvent } from "../../bus/events.js";
import type {
  QuorumProvider,
  ProviderCapability,
  ProviderConfig,
  ProviderStatus,
} from "../provider.js";

export class ClaudeCodeProvider implements QuorumProvider {
  readonly kind = "claude-code" as const;
  readonly displayName = "Claude Code";
  readonly capabilities: ProviderCapability[] = [
    "hooks",
    "worktree",
    "audit",
    "agent-spawn",
    "streaming",
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

    const inboxPath = resolve(config.repoRoot, ".claude", "quorum-inbox.jsonl");

    // Mode 1: Poll hook-generated inbox
    if (existsSync(inboxPath)) {
      this.pollInbox(inboxPath);
    }

    // Evidence comes from SQLite EventStore (no file watching needed)

    // Note: audit.lock monitoring removed — ProcessMux + SQLite LockService
    // now manage agent coordination. Audit state is tracked via audit-status.json
    // and SQLite events.

    this.bus.emit(createEvent("session.start", "claude-code", {
      mode: existsSync(inboxPath) ? "hook-forwarding" : "file-watch",
    }));
  }

  async stop(): Promise<void> {
    for (const id of this.intervals) {
      clearInterval(id);
    }
    this.intervals = [];

    // watchEvidence removed — evidence via audit_submit tool now

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

  // ── Internal watchers ─────────────────────────────

  private pollInbox(inboxPath: string): void {
    let lastLineCount = 0;
    let lastSize = existsSync(inboxPath) ? statSync(inboxPath).size : 0;

    // Initialize line count from existing file
    if (lastSize > 0) {
      try {
        lastLineCount = readFileSync(inboxPath, "utf8").trim().split(/\r?\n/).length;
      } catch (err) { console.warn(`[claude-code-adapter] inbox read failed, starting from 0: ${(err as Error).message}`); }
    }

    this.intervals.push(setInterval(() => {
      if (!existsSync(inboxPath) || !this.bus) return;

      const currentSize = statSync(inboxPath).size;
      if (currentSize === lastSize) return;

      // File was truncated/rewritten — reset tracking
      if (currentSize < lastSize) {
        lastLineCount = 0;
      }

      const content = readFileSync(inboxPath, "utf8");
      const lines = content.trim().split(/\r?\n/).filter(Boolean);

      // Process only lines after lastLineCount
      const newLines = lines.slice(lastLineCount);
      for (const line of newLines) {
        try {
          const event = JSON.parse(line);
          this.bus.emit(event);
          this.lastEventTime = Date.now();
        } catch (err) {
          console.warn(`[claude-code-adapter] malformed inbox line: ${(err as Error).message}`);
        }
      }

      lastLineCount = lines.length;
      lastSize = currentSize;
    }, 1000));
  }

  // watchAuditLock removed — ProcessMux + SQLite LockService manage agent coordination.
  // Audit events are now emitted via the event bus directly by the audit process.
}
