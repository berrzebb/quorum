/**
 * Denial Tracking — tracks per-tool denial counts for infinite-loop prevention.
 *
 * Thresholds:
 * - 3 consecutive denials → classifier fallback suggestion
 * - 20 cumulative denials → tool deactivated for session
 * - Success resets consecutive count (total preserved)
 *
 * Persisted to SQLite kv_state for crash recovery.
 *
 * @module bus/denial-tracking
 */

// ── Types ───────────────────────────────────────────

/** Per-tool denial statistics. */
export interface DenialStats {
  /** Consecutive denials without success. */
  consecutive: number;
  /** Total denials in session. */
  total: number;
  /** Timestamp of last denial. */
  lastDenied: number;
}

/** KV store interface (subset of what EventStore provides). */
export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

// ── Thresholds ──────────────────────────────────────

/** Consecutive denials before suggesting fallback. */
export const FALLBACK_THRESHOLD = 3;

/** Cumulative denials before deactivating tool for session. */
export const DEACTIVATE_THRESHOLD = 20;

// ── Denial Tracker ──────────────────────────────────

/**
 * Tracks denial counts per tool to prevent infinite denial loops.
 *
 * - recordDenial: increments both consecutive and total
 * - recordSuccess: resets consecutive to 0, total unchanged
 * - shouldFallback: true when consecutive >= 3
 * - shouldDeactivate: true when total >= 20
 */
export class DenialTracker {
  private stats = new Map<string, DenialStats>();
  private kvStore?: KVStore;

  constructor(kvStore?: KVStore) {
    this.kvStore = kvStore;
    this.loadFromKV();
  }

  /** Record a denial for a tool. */
  recordDenial(tool: string): void {
    const s = this.getOrCreate(tool);
    s.consecutive++;
    s.total++;
    s.lastDenied = Date.now();
    this.stats.set(tool, s);
    this.persistToKV(tool, s);
  }

  /** Record a success for a tool (resets consecutive, preserves total). */
  recordSuccess(tool: string): void {
    const s = this.stats.get(tool);
    if (!s) return;
    s.consecutive = 0;
    this.stats.set(tool, s);
    this.persistToKV(tool, s);
  }

  /** Check if classifier should suggest fallback alternative. */
  shouldFallback(tool: string): boolean {
    const s = this.stats.get(tool);
    return (s?.consecutive ?? 0) >= FALLBACK_THRESHOLD;
  }

  /** Check if tool should be deactivated for this session. */
  shouldDeactivate(tool: string): boolean {
    const s = this.stats.get(tool);
    return (s?.total ?? 0) >= DEACTIVATE_THRESHOLD;
  }

  /** Get current stats for a tool. */
  getStats(tool: string): DenialStats {
    return this.stats.get(tool) ?? { consecutive: 0, total: 0, lastDenied: 0 };
  }

  /** Reset all stats (session end). */
  resetAll(): void {
    for (const tool of this.stats.keys()) {
      this.kvStore?.delete(`denial:${tool}`);
    }
    this.stats.clear();
  }

  /** Reset stats for a specific tool. */
  reset(tool: string): void {
    this.stats.delete(tool);
    this.kvStore?.delete(`denial:${tool}`);
  }

  // ── Persistence ─────────────────────────────────

  private getOrCreate(tool: string): DenialStats {
    return this.stats.get(tool) ?? { consecutive: 0, total: 0, lastDenied: 0 };
  }

  private persistToKV(tool: string, stats: DenialStats): void {
    this.kvStore?.set(`denial:${tool}`, JSON.stringify(stats));
  }

  private loadFromKV(): void {
    if (!this.kvStore) return;
    // Load is best-effort — if KV is unavailable, start fresh
    try {
      // We can't enumerate keys from a generic KVStore,
      // so we rely on in-memory state populated during the session.
      // On restart, the first access will create fresh stats.
    } catch { /* fail-open */ }
  }

  /** Load stats for a specific tool from KV (for crash recovery). */
  loadToolFromKV(tool: string): void {
    if (!this.kvStore) return;
    try {
      const raw = this.kvStore.get(`denial:${tool}`);
      if (raw) {
        const parsed = JSON.parse(raw) as DenialStats;
        this.stats.set(tool, parsed);
      }
    } catch { /* fail-open */ }
  }
}
