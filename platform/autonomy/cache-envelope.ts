/**
 * Cache Envelope — prompt cache-safe autonomy context.
 *
 * Ensures proactive/background forks share cache-safe params
 * so prompt caching remains effective across turns.
 *
 * Detects cache breaks and emits telemetry (never silent failure).
 *
 * @module autonomy/cache-envelope
 * @since RAI-5
 */

import { djb2Hash as simpleHash } from "./hash-util.js";

// ── Types ────────────────────────────────────

/**
 * Immutable cache-safe parameters for a fork context.
 * These params MUST remain constant across turns to preserve prompt cache.
 */
export interface CacheSafeParams {
  /** System prompt hash (changes = cache break). */
  systemPromptHash: string;
  /** Tool list hash (changes = cache break). */
  toolListHash: string;
  /** Model identifier. */
  model: string;
  /** Temperature (must be constant). */
  temperature: number;
  /** Created at timestamp. */
  createdAt: number;
}

/**
 * Cache break detection result.
 */
export interface CacheBreakResult {
  /** Whether a cache break was detected. */
  broken: boolean;
  /** Which parameter changed. */
  changedParam: string | null;
  /** Previous value (for telemetry). */
  previousValue: string;
  /** New value. */
  newValue: string;
}

/**
 * Telemetry record for cache events.
 */
export interface CacheTelemetryRecord {
  ts: number;
  event: "hit" | "miss" | "break";
  reason: string;
  params: CacheSafeParams;
}

export type CacheTelemetryCallback = (record: CacheTelemetryRecord) => void;

// ── Cache-Safe Context ───────────────────────

const _callbacks: CacheTelemetryCallback[] = [];

/** Register cache telemetry callback. */
export function onCacheTelemetry(cb: CacheTelemetryCallback): void {
  _callbacks.push(cb);
}

/**
 * Create cache-safe params from current context.
 */
export function createCacheSafeParams(
  systemPrompt: string,
  toolList: string[],
  model: string,
  temperature = 0,
): CacheSafeParams {
  return {
    systemPromptHash: simpleHash(systemPrompt),
    toolListHash: simpleHash(toolList.join(",")),
    model,
    temperature,
    createdAt: Date.now(),
  };
}

/**
 * Detect if params have changed (cache break).
 */
export function detectCacheBreak(
  previous: CacheSafeParams,
  current: CacheSafeParams,
): CacheBreakResult {
  if (previous.systemPromptHash !== current.systemPromptHash) {
    return { broken: true, changedParam: "systemPrompt", previousValue: previous.systemPromptHash, newValue: current.systemPromptHash };
  }
  if (previous.toolListHash !== current.toolListHash) {
    return { broken: true, changedParam: "toolList", previousValue: previous.toolListHash, newValue: current.toolListHash };
  }
  if (previous.model !== current.model) {
    return { broken: true, changedParam: "model", previousValue: previous.model, newValue: current.model };
  }
  if (previous.temperature !== current.temperature) {
    return { broken: true, changedParam: "temperature", previousValue: String(previous.temperature), newValue: String(current.temperature) };
  }
  return { broken: false, changedParam: null, previousValue: "", newValue: "" };
}

/**
 * Emit cache telemetry.
 */
export function emitCacheEvent(
  event: "hit" | "miss" | "break",
  reason: string,
  params: CacheSafeParams,
): void {
  if (_callbacks.length === 0) return;
  const record: CacheTelemetryRecord = { ts: Date.now(), event, reason, params };
  for (const cb of _callbacks) {
    try { cb(record); } catch { /* telemetry must not break */ }
  }
}

