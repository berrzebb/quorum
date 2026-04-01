/**
 * File State Cache — bounded LRU cache for repeated file reads.
 *
 * Autonomy and remote inspect paths often read the same files repeatedly.
 * This cache provides a read-through LRU with bounded memory.
 *
 * Core rule: cached content is NEVER treated as authoritative.
 * Callers must know they're getting a potentially stale view.
 *
 * @module autonomy/file-state-cache
 * @since RAI-7
 */

import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { djb2Hash as simpleHash } from "./hash-util.js";

// ── Types ────────────────────────────────────

export interface CachedFileState {
  /** File path. */
  path: string;
  /** Content (full or partial). */
  content: string;
  /** Content hash for change detection. */
  contentHash: string;
  /** When this cache entry was loaded. */
  loadedAt: number;
  /** File mtime at load time. */
  mtimeMs: number;
  /** Whether this is a partial view (truncated). */
  partial: boolean;
}

export interface FileCacheConfig {
  /** Max entries in the LRU cache. Default: 100. */
  maxEntries: number;
  /** Max file size to cache (bytes). Default: 100KB. */
  maxFileSize: number;
  /** Max age before forced revalidation (ms). Default: 30s. */
  maxAgeMs: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  revalidations: number;
  size: number;
}

// ── Default Config ───────────────────────────

export function defaultFileCacheConfig(): FileCacheConfig {
  return {
    maxEntries: 100,
    maxFileSize: 100_000,
    maxAgeMs: 30_000,
  };
}

// ── LRU File Cache ───────────────────────────

export class FileStateCache {
  private cache = new Map<string, CachedFileState>();
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, revalidations: 0, size: 0 };

  constructor(private readonly config: FileCacheConfig = defaultFileCacheConfig()) {}

  /**
   * Read a file, using cache if available and fresh.
   * Returns null if file doesn't exist or is too large.
   */
  read(path: string, now?: number): CachedFileState | null {
    const currentTime = now ?? Date.now();

    // Check cache
    const cached = this.cache.get(path);
    if (cached) {
      // Check freshness
      if (currentTime - cached.loadedAt < this.config.maxAgeMs) {
        this.stats.hits++;
        this.promoteLRU(path, cached);
        return cached;
      }

      // Revalidate: check mtime
      try {
        const stat = statSync(path);
        if (stat.mtimeMs === cached.mtimeMs) {
          // Content unchanged — refresh loadedAt
          cached.loadedAt = currentTime;
          this.stats.hits++;
          this.stats.revalidations++;
          this.promoteLRU(path, cached);
          return cached;
        }
      } catch {
        // File gone — evict
        this.evict(path);
        return null;
      }
    }

    // Cache miss — load from disk
    this.stats.misses++;
    return this.loadAndCache(path, currentTime);
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(path: string): void {
    this.evict(path);
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return { ...this.stats, size: this.cache.size };
  }

  // ── Private ──────────────────────────────

  private loadAndCache(path: string, now: number): CachedFileState | null {
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return null;

      let content: string;
      let partial = false;

      if (stat.size > this.config.maxFileSize) {
        const buf = Buffer.alloc(this.config.maxFileSize);
        const fd = openSync(path, "r");
        try {
          readSync(fd, buf, 0, this.config.maxFileSize, 0);
        } finally {
          closeSync(fd);
        }
        content = buf.toString("utf8");
        partial = true;
      } else {
        content = readFileSync(path, "utf8");
      }

      const entry: CachedFileState = {
        path,
        content,
        contentHash: simpleHash(content),
        loadedAt: now,
        mtimeMs: stat.mtimeMs,
        partial,
      };

      // Enforce LRU bounds — Map iteration order = insertion order
      while (this.cache.size >= this.config.maxEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest) { this.cache.delete(oldest); this.stats.evictions++; }
        else break;
      }

      this.cache.set(path, entry);

      return entry;
    } catch {
      return null;
    }
  }

  private evict(path: string): void {
    if (this.cache.delete(path)) {
      this.stats.evictions++;
    }
  }

  /** Promote entry to newest position via delete + re-set (O(1) Map LRU). */
  private promoteLRU(path: string, entry: CachedFileState): void {
    this.cache.delete(path);
    this.cache.set(path, entry);
  }
}
