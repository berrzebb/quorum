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
let _lockService = null;
let _modules = null;

async function loadModules() {
  if (_modules) return _modules;
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const [storeMod, eventsMod, triggerMod, routerMod, stagnationMod, lockMod] = await Promise.all([
      import(toURL(resolve(DIST, "bus", "store.js"))),
      import(toURL(resolve(DIST, "bus", "events.js"))),
      import(toURL(resolve(DIST, "providers", "trigger.js"))),
      import(toURL(resolve(DIST, "providers", "router.js"))),
      import(toURL(resolve(DIST, "bus", "stagnation.js"))),
      import(toURL(resolve(DIST, "bus", "lock.js"))),
    ]);
    _modules = { storeMod, eventsMod, triggerMod, routerMod, stagnationMod, lockMod };
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

function getLockService() {
  if (_lockService) return _lockService;
  if (!_modules || !_store) return null;
  try {
    const { LockService } = _modules.lockMod;
    _lockService = new LockService(_store.getDb());
    return _lockService;
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

// ── Lock management (replaces JSON lock files) ──

/**
 * Acquire a named lock atomically. No TOCTOU.
 * Returns true if acquired, false if held by another PID.
 */
export function acquireLock(lockName, pid, sessionId, ttlMs) {
  const svc = getLockService();
  if (!svc) return false;
  try {
    return svc.acquire(lockName, pid, sessionId, ttlMs);
  } catch {
    return false;
  }
}

/**
 * Release a named lock. Only owner PID can release.
 */
export function releaseLock(lockName, pid) {
  const svc = getLockService();
  if (!svc) return false;
  try {
    return svc.release(lockName, pid);
  } catch {
    return false;
  }
}

/**
 * Check if a lock is held.
 */
export function isLockHeld(lockName) {
  const svc = getLockService();
  if (!svc) return { held: false };
  try {
    return svc.isHeld(lockName);
  } catch {
    return { held: false };
  }
}

// ── KV state (replaces JSON marker/session files) ──

/**
 * Read a KV state entry. Returns parsed JSON or null.
 */
export function getState(key) {
  if (!_store) return null;
  try {
    return _store.getKV(key);
  } catch {
    return null;
  }
}

/**
 * Write a KV state entry.
 */
export function setState(key, value) {
  if (!_store) return false;
  try {
    _store.setKV(key, value);
    return true;
  } catch {
    return false;
  }
}

// ── State transitions (replaces markdown tag management) ──

/**
 * Record a state transition.
 * Returns the transition ID or null on failure.
 */
export function recordTransition(entityType, entityId, fromState, toState, source, metadata = {}) {
  if (!_store) return null;
  try {
    _store.commitTransaction([], [{
      entityType,
      entityId,
      fromState,
      toState,
      source,
      metadata,
    }], []);
    return "ok";
  } catch {
    return null;
  }
}

/**
 * Get current state for an entity.
 */
export function currentState(entityType, entityId) {
  if (!_store) return null;
  try {
    return _store.currentState(entityType, entityId);
  } catch {
    return null;
  }
}

// ── TransactionalUnitOfWork factory ──

/**
 * Create a new TransactionalUnitOfWork for atomic multi-store commits.
 * Returns null if store unavailable.
 */
export function createUnitOfWork() {
  if (!_modules || !_store) return null;
  try {
    const { TransactionalUnitOfWork } = _modules.storeMod;
    return new TransactionalUnitOfWork(_store);
  } catch {
    return null;
  }
}

// ── Domain detection + specialist routing ────

let _domainMod = null;
let _routerMod2 = null;
let _specialistMod = null;

async function loadDomainModules() {
  if (_domainMod) return { _domainMod, _routerMod2, _specialistMod };
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const [dm, rm, sm] = await Promise.all([
      import(toURL(resolve(DIST, "providers", "domain-detect.js"))),
      import(toURL(resolve(DIST, "providers", "domain-router.js"))),
      import(toURL(resolve(DIST, "providers", "specialist.js"))),
    ]);
    _domainMod = dm;
    _routerMod2 = rm;
    _specialistMod = sm;
    return { _domainMod, _routerMod2, _specialistMod };
  } catch {
    return null;
  }
}

/**
 * Detect active domains from changed files and diff content.
 * Returns null if modules unavailable.
 */
export async function detectDomains(changedFiles, diff) {
  const mods = await loadDomainModules();
  if (!mods?._domainMod) return null;
  try {
    return mods._domainMod.detectDomains(changedFiles, diff);
  } catch {
    return null;
  }
}

/**
 * Select specialist reviewers based on detected domains and audit tier.
 * Returns null if modules unavailable.
 */
export async function selectReviewers(domains, tier) {
  const mods = await loadDomainModules();
  if (!mods?._routerMod2) return null;
  try {
    return mods._routerMod2.selectReviewers(domains, tier);
  } catch {
    return null;
  }
}

/**
 * Run specialist deterministic tools and return results.
 * Returns null if modules unavailable.
 */
export async function runSpecialistTools(selection, evidence, cwd) {
  const mods = await loadDomainModules();
  if (!mods?._specialistMod) return null;
  try {
    return await mods._specialistMod.runSpecialistReviews(selection, evidence, cwd);
  } catch {
    return null;
  }
}

/**
 * Enrich evidence with specialist review section.
 * Returns original evidence if modules unavailable.
 */
export async function enrichEvidence(evidence, toolResults, opinions) {
  const mods = await loadDomainModules();
  if (!mods?._specialistMod) return evidence;
  try {
    return mods._specialistMod.enrichEvidence(evidence, toolResults, opinions);
  } catch {
    return evidence;
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
  _lockService = null;
  _modules = null;
  _domainMod = null;
  _routerMod2 = null;
  _specialistMod = null;
}
