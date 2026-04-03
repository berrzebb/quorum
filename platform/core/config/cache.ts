/**
 * Config Cache — 3-layer caching for settings hierarchy.
 *
 * Layer 1: Session cache — cached merged result
 * Layer 2: Per-source cache — cached per-tier parsed results
 * Layer 3: File content cache — raw file content (skip re-parse if unchanged)
 *
 * All layers use structuredClone for clone-on-return safety.
 *
 * @module core/config/cache
 */

import type { ConfigTier, QuorumConfig } from "./types.js";

// ── Cache State ─────────────────────────────────────

/** Layer 1: Session-level merged config cache. */
let _sessionCache: QuorumConfig | null = null;

/** Layer 2: Per-tier parsed config cache. */
const _tierCache = new Map<ConfigTier, Partial<QuorumConfig>>();

/** Layer 3: File content hash cache (content → parsed result is stable). */
const _fileContentCache = new Map<string, { content: string; parsed: Partial<QuorumConfig> }>();

// ── Layer 1: Session Cache ──────────────────────────

/** Get the cached merged config (or null if cache miss). */
export function getSessionCache(): QuorumConfig | null {
  if (!_sessionCache) return null;
  return structuredClone(_sessionCache);
}

/** Store the merged config in session cache. */
export function setSessionCache(config: QuorumConfig): void {
  _sessionCache = structuredClone(config);
}

/** Clear the session cache. */
export function clearSessionCache(): void {
  _sessionCache = null;
}

// ── Layer 2: Per-Tier Cache ─────────────────────────

/** Get cached config for a specific tier. */
export function getTierCache(tier: ConfigTier): Partial<QuorumConfig> | null {
  const cached = _tierCache.get(tier);
  if (!cached) return null;
  return structuredClone(cached);
}

/** Store config for a specific tier. */
export function setTierCache(tier: ConfigTier, config: Partial<QuorumConfig>): void {
  _tierCache.set(tier, structuredClone(config));
}

/** Invalidate a specific tier's cache (forces re-parse). */
export function invalidateTier(tier: ConfigTier): void {
  _tierCache.delete(tier);
  _sessionCache = null; // Session cache depends on all tiers
}

// ── Layer 3: File Content Cache ─────────────────────

/**
 * Check if file content matches cache. Returns cached parse result if match.
 * Avoids re-parsing when file content hasn't changed (e.g., editor save without modification).
 */
export function getContentCache(filePath: string, content: string): Partial<QuorumConfig> | null {
  const cached = _fileContentCache.get(filePath);
  if (cached && cached.content === content) {
    return structuredClone(cached.parsed);
  }
  return null;
}

/** Store parsed result associated with file content. */
export function setContentCache(filePath: string, content: string, parsed: Partial<QuorumConfig>): void {
  _fileContentCache.set(filePath, { content, parsed: structuredClone(parsed) });
}

// ── Full Reset ──────────────────────────────────────

/** Reset all 3 cache layers. */
export function resetAllCaches(): void {
  _sessionCache = null;
  _tierCache.clear();
  _fileContentCache.clear();
}
