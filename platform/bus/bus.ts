/**
 * Quorum Event Bus — in-process pub/sub with pluggable persistence.
 *
 * Supports two backends:
 * - SQLite (default): via EventStore, shared with TUI — no IPC needed
 * - JSONL (fallback): for environments where native modules aren't available
 *
 * The bus itself handles pub/sub only. Persistence is delegated to the store.
 */

import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EventType, QuorumEvent } from "./events.js";
import type { EventStore } from "./store.js";

export interface BusOptions {
  /** SQLite EventStore instance. Takes precedence over logPath. */
  store?: EventStore;
  /** Path to JSONL event log (fallback when store is not provided). */
  logPath?: string | null;
  /** Max events to keep in memory ring buffer. */
  bufferSize?: number;
}

export class QuorumBus {
  private emitter = new EventEmitter();
  private buffer: QuorumEvent[] = [];
  private bufferSize: number;
  private store: EventStore | null;
  private logPath: string | null;

  constructor(opts: BusOptions = {}) {
    this.bufferSize = opts.bufferSize ?? 500;
    this.store = opts.store ?? null;
    this.logPath = this.store ? null : (opts.logPath ?? null);

    if (this.logPath) {
      const dir = dirname(this.logPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  /** Emit an event to all subscribers + persist. */
  emit(event: QuorumEvent): void {
    // Ring buffer — trim in bulk when 2× capacity to amortize O(n) cost
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize * 2) {
      this.buffer = this.buffer.slice(-this.bufferSize);
    }

    // Persist
    if (this.store) {
      this.store.append(event);
    } else if (this.logPath) {
      appendFileSync(this.logPath, JSON.stringify(event) + "\n");
    }

    // Broadcast
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  /** Subscribe to a specific event type. */
  on(type: EventType | "*", handler: (event: QuorumEvent) => void): void {
    this.emitter.on(type, handler);
  }

  /** Subscribe once. */
  once(type: EventType | "*", handler: (event: QuorumEvent) => void): void {
    this.emitter.once(type, handler);
  }

  /** Unsubscribe. */
  off(type: EventType | "*", handler: (event: QuorumEvent) => void): void {
    this.emitter.off(type, handler);
  }

  /** Get recent events from memory buffer or store. */
  recent(count?: number): QuorumEvent[] {
    const n = Math.min(count ?? this.bufferSize, this.buffer.length);
    return this.buffer.slice(-n);
  }

  /** Filter recent events by type. */
  recentByType(type: EventType, count?: number): QuorumEvent[] {
    const filtered = this.buffer.filter((e) => e.type === type);
    return count ? filtered.slice(-count) : filtered;
  }

  /**
   * Load events from persistence (SQLite or JSONL) for session recovery.
   * Populates the in-memory ring buffer.
   */
  loadFromLog(): QuorumEvent[] {
    let events: QuorumEvent[];

    if (this.store) {
      events = this.store.recent(this.bufferSize);
    } else if (this.logPath && existsSync(this.logPath)) {
      const lines = readFileSync(this.logPath, "utf8").trim().split("\n");
      events = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          events.push(JSON.parse(line) as QuorumEvent);
        } catch (err) {
          // Skip malformed lines — log for debugging
          if (process.env.QUORUM_DEBUG) {
            console.error(`[QuorumBus] Malformed JSONL line skipped: ${(err as Error).message}`);
          }
        }
      }
    } else {
      return [];
    }

    this.buffer = events.slice(-this.bufferSize);
    return events;
  }

  /** Clear the ring buffer (does not delete persisted events). */
  clear(): void {
    this.buffer = [];
  }

  /** Get the underlying EventStore (if using SQLite backend). */
  getStore(): EventStore | null {
    return this.store;
  }
}
