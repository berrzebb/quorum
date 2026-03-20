/**
 * Bridge — connects existing MJS hooks to the new TypeScript modules.
 *
 * Lazily imports compiled dist/ modules so MJS hooks can use:
 * - EventStore (SQLite persistence)
 * - Trigger evaluation (skip/simple/deliberative)
 * - TierRouter (escalation tracking)
 * - Stagnation detection
 *
 * All functions are fail-safe: if dist/ modules aren't available,
 * operations silently no-op (existing audit flow continues unaffected).
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUORUM_ROOT = resolve(__dirname, "..");
const DIST = resolve(QUORUM_ROOT, "dist");

// ── Lazy singletons ───────────────────────────

let _store = null;
let _router = null;
let _modules = null;

async function loadModules() {
  if (_modules) return _modules;
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const [storeMod, eventsMod, triggerMod, routerMod, stagnationMod] = await Promise.all([
      import(toURL(resolve(DIST, "bus", "store.js"))),
      import(toURL(resolve(DIST, "bus", "events.js"))),
      import(toURL(resolve(DIST, "providers", "trigger.js"))),
      import(toURL(resolve(DIST, "providers", "router.js"))),
      import(toURL(resolve(DIST, "bus", "stagnation.js"))),
    ]);
    _modules = { storeMod, eventsMod, triggerMod, routerMod, stagnationMod };
    return _modules;
  } catch {
    return null;
  }
}

function getStore(repoRoot) {
  if (_store) return _store;
  try {
    const dbDir = resolve(repoRoot, ".claude");
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    const dbPath = resolve(dbDir, "quorum-events.db");
    // Synchronous import for store (better-sqlite3 is sync)
    const { EventStore } = _modules.storeMod;
    _store = new EventStore({ dbPath });
    return _store;
  } catch {
    return null;
  }
}

function getRouter() {
  if (_router) return _router;
  try {
    const { TierRouter } = _modules.routerMod;
    _router = new TierRouter();
    return _router;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────

/**
 * Initialize the bridge. Call once at hook startup.
 * Returns true if TS modules are available, false if running in legacy mode.
 */
export async function init(repoRoot) {
  const mods = await loadModules();
  if (!mods) return false;
  getStore(repoRoot);
  getRouter();
  return true;
}

/**
 * Emit an event to the SQLite EventStore.
 */
export function emitEvent(type, source, payload = {}, meta = {}) {
  if (!_modules || !_store) return null;
  const { createEvent } = _modules.eventsMod;
  const event = createEvent(type, source, payload, meta);
  try {
    return _store.append(event);
  } catch {
    return null;
  }
}

/**
 * Evaluate whether this change needs audit, and at what level.
 * Returns { mode: "skip"|"simple"|"deliberative", tier, score, reasons }
 * Returns null if modules unavailable (legacy mode → always audit).
 */
export function evaluateTrigger(context) {
  if (!_modules) return null;
  const { evaluateTrigger: evaluate } = _modules.triggerMod;
  return evaluate(context);
}

/**
 * Record an audit verdict result for router escalation tracking.
 * Returns { escalated, tier } or null.
 */
export function recordVerdict(taskKey, success) {
  const router = getRouter();
  if (!router) return null;
  return router.recordResult(taskKey, success);
}

/**
 * Get router's current tier for a task.
 */
export function currentTier(taskKey) {
  const router = getRouter();
  if (!router) return null;
  return router.currentTier(taskKey);
}

/**
 * Detect stagnation in recent audit verdicts.
 * Returns { detected, patterns, recommendation } or null.
 */
export function detectStagnation(repoRoot) {
  if (!_modules || !_store) return null;
  const { detectStagnation: detect } = _modules.stagnationMod;
  try {
    const verdictEvents = _store.query({ eventType: "audit.verdict" });
    if (verdictEvents.length < 3) return { detected: false, patterns: [], recommendation: "continue" };
    return detect(verdictEvents);
  } catch {
    return null;
  }
}

/**
 * Query recent events from the store.
 */
export function queryEvents(filter = {}) {
  if (!_store) return [];
  try {
    return _store.query(filter);
  } catch {
    return [];
  }
}

/**
 * Close the store connection. Call at hook exit.
 */
export function close() {
  if (_store) {
    try { _store.close(); } catch { /* ignore */ }
    _store = null;
  }
  _router = null;
  _modules = null;
}
