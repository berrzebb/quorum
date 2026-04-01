/**
 * Bridge — connects existing MJS hooks to the new TypeScript modules.
 *
 * Canonical implementation (moved from core/bridge.mjs).
 * core/bridge.mjs is now a thin re-export facade.
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

/**
 * This file lives at platform/core/bridge.mjs, so we resolve two levels up
 * to reach the quorum package root.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const QUORUM_ROOT = resolve(__dirname, "..", "..");
const DIST = resolve(QUORUM_ROOT, "dist", "platform");

// ── Lazy singletons ───────────────────────────

let _store = null;
let _router = null;
let _lockService = null;
let _modules = null;

async function loadModules() {
  if (_modules) return _modules;
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const [storeMod, eventsMod, triggerMod, routerMod, stagnationMod, lockMod, messageBusMod, fitnessMod, fitnessLoopMod, claimMod, parallelMod, orchestratorMod, autoLearnMod, parliamentGateMod] = await Promise.all([
      import(toURL(resolve(DIST, "bus", "store.js"))),
      import(toURL(resolve(DIST, "bus", "events.js"))),
      import(toURL(resolve(DIST, "providers", "trigger.js"))),
      import(toURL(resolve(DIST, "providers", "router.js"))),
      import(toURL(resolve(DIST, "bus", "stagnation.js"))),
      import(toURL(resolve(DIST, "bus", "lock.js"))),
      import(toURL(resolve(DIST, "bus", "message-bus.js"))),
      import(toURL(resolve(DIST, "bus", "fitness.js"))).catch(() => null),
      import(toURL(resolve(DIST, "bus", "fitness-loop.js"))).catch(() => null),
      import(toURL(resolve(DIST, "bus", "claim.js"))).catch(() => null),
      import(toURL(resolve(DIST, "bus", "parallel.js"))).catch(() => null),
      import(toURL(resolve(DIST, "bus", "orchestrator.js"))).catch(() => null),
      import(toURL(resolve(DIST, "bus", "auto-learn.js"))).catch(() => null),
      import(toURL(resolve(DIST, "bus", "parliament-gate.js"))).catch(() => null),
    ]);
    _modules = { storeMod, eventsMod, triggerMod, routerMod, stagnationMod, lockMod, messageBusMod, fitnessMod, fitnessLoopMod, claimMod, parallelMod, orchestratorMod, autoLearnMod, parliamentGateMod };
    return _modules;
  } catch (err) {
    console.warn("[bridge] loadModules failed:", err?.message ?? err);
    return null;
  }
}

// ── Parliament lazy-load (meeting-log, amendment, confluence, normal-form, parliament-session) ──
// These 5 modules are only needed for T3 deliberative sessions, not every hook invocation.

let _parliamentModules = null;

async function loadParliamentModules() {
  if (_parliamentModules) return _parliamentModules;
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const [meetingLogMod, amendmentMod, confluenceMod, normalFormMod, parliamentSessionMod] = await Promise.all([
      import(toURL(resolve(DIST, "bus", "meeting-log.js"))),
      import(toURL(resolve(DIST, "bus", "amendment.js"))),
      import(toURL(resolve(DIST, "bus", "confluence.js"))),
      import(toURL(resolve(DIST, "bus", "normal-form.js"))),
      import(toURL(resolve(DIST, "bus", "parliament-session.js"))),
    ]);
    _parliamentModules = { meetingLogMod, amendmentMod, confluenceMod, normalFormMod, parliamentSessionMod };
    return _parliamentModules;
  } catch (err) {
    console.warn("[bridge] loadParliamentModules failed:", err?.message ?? err);
    return null;
  }
}

function getStore(repoRoot) {
  if (_store) return _store;
  try {
    const dbDir = resolve(repoRoot, ".claude");
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    const dbPath = resolve(dbDir, "quorum-events.db");
    // Synchronous import for store (SQLite adapter: bun:sqlite or better-sqlite3)
    const { EventStore } = _modules.storeMod;
    _store = new EventStore({ dbPath });
    return _store;
  } catch (err) {
    console.warn("[bridge] getStore failed:", err?.message ?? err);
    return null;
  }
}

function getRouter() {
  if (_router) return _router;
  try {
    const { TierRouter } = _modules.routerMod;
    _router = new TierRouter();
    return _router;
  } catch (err) {
    console.warn("[bridge] getRouter failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] getLockService failed:", err?.message ?? err);
    return null;
  }
}

let _claimService = null;

function getClaimService() {
  if (_claimService) return _claimService;
  if (!_modules?.claimMod || !_store) return null;
  try {
    const { ClaimService } = _modules.claimMod;
    _claimService = new ClaimService(_store.getDb());
    return _claimService;
  } catch (err) {
    console.warn("[bridge] getClaimService failed:", err?.message ?? err);
    return null;
  }
}

// ── Public API ────────────────────────────────

/**
 * Initialize the bridge. Call once at hook startup.
 * Returns true if TS modules are available, false if running in legacy mode.
 */
export async function init(repoRoot) {
  if (!repoRoot || !existsSync(repoRoot)) return false;
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
  } catch (err) {
    console.warn("[bridge] emitEvent failed:", err?.message ?? err);
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
    const verdictEvents = _store.query({ eventType: "audit.verdict", limit: 50, descending: true }).reverse();
    if (verdictEvents.length < 3) return { detected: false, patterns: [], recommendation: "continue" };
    return detect(verdictEvents);
  } catch (err) {
    console.warn("[bridge] detectStagnation failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] queryEvents failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] acquireLock failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] releaseLock failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] isLockHeld failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] getState failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] setState failed:", err?.message ?? err);
    return false;
  }
}

/**
 * Get the latest submitted evidence content from KV store.
 * Returns { content, changedFiles, timestamp } or null.
 */
export function getLatestEvidence() {
  return getState("evidence:latest");
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
  } catch (err) {
    console.warn("[bridge] recordTransition failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] currentState failed:", err?.message ?? err);
    return null;
  }
}

/**
 * Query current states for all audit items.
 * Returns array of { entityId, currentState, source, metadata, updatedAt } or empty array.
 */
let _stmtItemStates = null;
export function queryItemStates() {
  if (!_store) return [];
  try {
    if (!_stmtItemStates) {
      _stmtItemStates = _store.getDb().prepare(`
        SELECT entity_id, to_state, source, metadata, created_at
        FROM state_transitions st1
        WHERE entity_type = 'audit_item'
          AND rowid = (
            SELECT rowid FROM state_transitions st2
            WHERE st2.entity_type = st1.entity_type
              AND st2.entity_id = st1.entity_id
            ORDER BY st2.created_at DESC, st2.rowid DESC
            LIMIT 1
          )
        ORDER BY created_at DESC
      `);
    }
    const rows = _stmtItemStates.all();
    return rows.map(r => ({
      entityId: r.entity_id,
      currentState: r.to_state,
      source: r.source,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
      updatedAt: r.created_at,
    }));
  } catch (err) {
    console.warn("[bridge] queryItemStates failed:", err?.message ?? err);
    return [];
  }
}

// ── File Claims (per-file ownership for parallel agents) ──

/**
 * Atomically claim files for an agent. Returns conflicts or empty array on success.
 */
export function claimFiles(agentId, files, sessionId, ttlMs) {
  const svc = getClaimService();
  if (!svc) return [];
  try {
    return svc.claimFiles(agentId, files, sessionId, ttlMs);
  } catch (err) {
    console.warn("[bridge] claimFiles failed:", err?.message ?? err);
    return [];
  }
}

/**
 * Release all file claims held by an agent.
 */
export function releaseFiles(agentId) {
  const svc = getClaimService();
  if (!svc) return 0;
  try {
    return svc.releaseFiles(agentId);
  } catch (err) {
    console.warn("[bridge] releaseFiles failed:", err?.message ?? err);
    return 0;
  }
}

/**
 * Check which files would conflict if an agent claimed them (read-only).
 */
export function checkConflicts(agentId, files) {
  const svc = getClaimService();
  if (!svc) return [];
  try {
    return svc.checkConflicts(agentId, files);
  } catch (err) {
    console.warn("[bridge] checkConflicts failed:", err?.message ?? err);
    return [];
  }
}

/**
 * Get all active file claims, optionally filtered by agent.
 */
export function getClaims(agentId) {
  const svc = getClaimService();
  if (!svc) return [];
  try {
    return svc.getClaims(agentId);
  } catch (err) {
    console.warn("[bridge] getClaims failed:", err?.message ?? err);
    return [];
  }
}

// ── Execution Planning (orchestrator + parallel planner) ──

/**
 * Plan parallel execution groups from work items.
 * Returns { groups, depth, maxWidth, unschedulable }.
 */
export function planExecution(items) {
  if (!_modules?.parallelMod) return null;
  try {
    return _modules.parallelMod.planParallel(items);
  } catch (err) {
    console.warn("[bridge] planExecution failed:", err?.message ?? err);
    return null;
  }
}

/**
 * Auto-select orchestration mode for work items.
 * Returns { mode, plan, reasons, maxConcurrency }.
 */
export function selectExecutionMode(items) {
  if (!_modules?.orchestratorMod) return null;
  try {
    return _modules.orchestratorMod.selectMode(items);
  } catch (err) {
    console.warn("[bridge] selectExecutionMode failed:", err?.message ?? err);
    return null;
  }
}

/**
 * Validate a plan against live file claims.
 */
export function validatePlanClaims(plan, agentId) {
  if (!_modules?.parallelMod) return new Map();
  const svc = getClaimService();
  if (!svc) return new Map();
  try {
    return _modules.parallelMod.validateAgainstClaims(plan, svc, agentId);
  } catch (err) {
    console.warn("[bridge] validatePlanClaims failed:", err?.message ?? err);
    return new Map();
  }
}

// ── Auto-Learning (audit pattern detection) ──

/**
 * Analyze audit history for repeat patterns and generate CLAUDE.md rule suggestions.
 * Returns { patterns, suggestions, eventsAnalyzed }.
 */
export function analyzeAuditLearnings() {
  if (!_modules?.autoLearnMod || !_store) return null;
  try {
    return _modules.autoLearnMod.analyzeAndSuggest(_store);
  } catch (err) {
    console.warn("[bridge] analyzeAuditLearnings failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] createUnitOfWork failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] loadDomainModules failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] detectDomains failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] selectReviewers failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] runSpecialistTools failed:", err?.message ?? err);
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
  } catch (err) {
    console.warn("[bridge] enrichEvidence failed:", err?.message ?? err);
    return evidence;
  }
}

// ── MessageBus (finding-level communication) ─

let _messageBus = null;

/**
 * Get or create a MessageBus instance for finding-level communication.
 * Returns null if store unavailable.
 */
export function getMessageBus() {
  if (!_store) return null;
  if (_messageBus) return _messageBus;
  try {
    if (_modules?.messageBusMod?.MessageBus) {
      _messageBus = new _modules.messageBusMod.MessageBus(_store);
    }
    return _messageBus;
  } catch (err) {
    console.warn("[bridge] getMessageBus failed:", err?.message ?? err);
    return null;
  }
}

// ── Agent Communication (query/response) ────

/** Post a query to another agent (or broadcast). Returns queryId or null. */
export function postAgentQuery(fromAgent, question, toAgent, context) {
  const mb = getMessageBus();
  if (!mb) return null;
  try { return mb.postQuery({ fromAgent, question, toAgent, context }); } catch (err) { console.warn("[bridge] postAgentQuery failed:", err?.message ?? err); return null; }
}

/** Respond to an agent query. */
export function respondToAgentQuery(queryId, fromAgent, answer, confidence) {
  const mb = getMessageBus();
  if (!mb) return;
  try { mb.respondToQuery({ queryId, fromAgent, answer, confidence }); } catch (err) { console.warn("[bridge] respondToAgentQuery failed:", err?.message ?? err); }
}

/** Poll for queries addressed to this agent (or broadcast). */
export function pollAgentQueries(agentId, since) {
  const mb = getMessageBus();
  if (!mb) return [];
  try { return mb.pollQueries(agentId, since); } catch (err) { console.warn("[bridge] pollAgentQueries failed:", err?.message ?? err); return []; }
}

/** Get all responses to a specific query. */
export function getQueryResponses(queryId) {
  const mb = getMessageBus();
  if (!mb) return [];
  try { return mb.getResponses(queryId); } catch (err) { console.warn("[bridge] getQueryResponses failed:", err?.message ?? err); return []; }
}

/** Get the agent roster for a track. */
export function getAgentRoster(trackId) {
  return getState(`agent:roster:${trackId ?? "default"}`);
}

/** Set the agent roster for a track. */
export function setAgentRoster(trackId, roster) {
  return setState(`agent:roster:${trackId ?? "default"}`, roster);
}

/**
 * Parse specialist ToolResult into Finding objects.
 * Returns empty array if modules unavailable.
 */
export function parseToolFindings(toolResult) {
  try {
    const mods = _specialistMod;
    if (mods?.parseToolFindings) {
      return mods.parseToolFindings(toolResult);
    }
    return [];
  } catch (err) {
    console.warn("[bridge] parseToolFindings failed:", err?.message ?? err);
    return [];
  }
}

// ── Fitness ─────────────────────────────────────

let _fitnessLoop = null;

/**
 * Get or create a FitnessLoop instance. Fail-safe: returns null if modules unavailable.
 */
export function getFitnessLoop() {
  if (_fitnessLoop) return _fitnessLoop;
  if (!_modules?.fitnessLoopMod) return null;
  try {
    if (!_store) return null;
    _fitnessLoop = new _modules.fitnessLoopMod.FitnessLoop(_store);
    return _fitnessLoop;
  } catch (err) {
    console.warn("[bridge] getFitnessLoop failed:", err?.message ?? err);
    return null;
  }
}

/**
 * Compute a fitness score from signals. Fail-safe: returns null.
 */
export function computeFitness(signals, config) {
  if (!_modules?.fitnessMod) return null;
  try {
    return _modules.fitnessMod.computeFitness(signals, config);
  } catch (err) {
    console.warn("[bridge] computeFitness failed:", err?.message ?? err);
    return null;
  }
}

// ── Blast Radius ─────────────────────────────

let _toolCoreMod = null;

/** Lazy-load tool-core.mjs (cached after first call). */
async function _getToolCore() {
  if (_toolCoreMod) return _toolCoreMod;
  const toURL = (p) => pathToFileURL(p).href;
  _toolCoreMod = await import(toURL(resolve(QUORUM_ROOT, "platform", "core", "tools", "tool-core.mjs")));
  return _toolCoreMod;
}

/**
 * Compute transitive blast radius for changed files.
 * @param {string[]} changedFiles - relative or absolute paths
 * @returns {Promise<{affected: number, total: number, ratio: number, files: any[]}|null>}
 */
export async function computeBlastRadius(changedFiles) {
  try {
    const tc = await _getToolCore();
    return tc.computeBlastRadius(process.cwd(), changedFiles.map(f => resolve(process.cwd(), f)));
  } catch (err) { console.warn("[bridge] computeBlastRadius failed:", err?.message ?? err); return null; }
}

/**
 * Close the store connection. Call at hook exit.
 */
// ── HookRunner integration ────────────────────

let _hookRunner = null;

/**
 * Initialize the HookRunner from config and/or HOOK.md.
 * Call after init() — hooks fire at audit lifecycle events.
 *
 * @param {string} repoRoot — workspace directory
 * @param {object} [hooksCfg] — hooks section from config.json (optional)
 * @returns {import("../adapters/shared/hook-runner.mjs").HookRunner|null}
 */
export async function initHookRunner(repoRoot, hooksCfg) {
  if (_hookRunner) return _hookRunner;
  try {
    const { HookRunner } = await import("../adapters/shared/hook-runner.mjs");
    const { loadHooksFromFile, mergeHooksConfigs, hooksConfigFromJson } = await import("../adapters/shared/hook-loader.mjs");

    const fileConfig = loadHooksFromFile(repoRoot, "HOOK.md");
    const jsonConfig = hooksCfg ? hooksConfigFromJson({ hooks: hooksCfg }) : { hooks: {} };
    const merged = mergeHooksConfigs(fileConfig, jsonConfig);

    _hookRunner = new HookRunner(repoRoot, merged);
    return _hookRunner;
  } catch (err) {
    console.warn("[bridge] initHookRunner failed:", err?.message ?? err);
    return null;
  }
}

/**
 * Get the current HookRunner instance (null if not initialized).
 * @returns {import("../adapters/shared/hook-runner.mjs").HookRunner|null}
 */
export function getHookRunner() {
  return _hookRunner;
}

/**
 * Fire a quorum lifecycle hook event.
 * Fail-safe — returns empty array if HookRunner unavailable.
 *
 * @param {string} event — hook event name (e.g., "audit.submit", "audit.verdict", "PreToolUse")
 * @param {object} input — HookInput fields
 * @returns {Promise<import("../adapters/shared/hook-runner.mjs").HookExecutionResult[]>}
 */
export async function fireHook(event, input = {}) {
  if (!_hookRunner) return [];
  try {
    return await _hookRunner.fire(event, { hook_event_name: event, ...input });
  } catch (err) {
    console.warn("[bridge] fireHook failed:", err?.message ?? err);
    return [];
  }
}

/**
 * Check if any hook would deny the given event.
 * Returns { allowed: true } or { allowed: false, reason }.
 *
 * @param {string} event
 * @param {object} input
 * @returns {Promise<{ allowed: boolean, reason?: string, additional_context?: string }>}
 */
export async function checkHookGate(event, input = {}) {
  const results = await fireHook(event, input);
  for (const r of results) {
    if (r.output.decision === "deny") {
      return { allowed: false, reason: r.output.reason || `blocked by hook: ${r.hook_name}`, additional_context: r.output.additional_context };
    }
  }
  const contexts = results.filter((r) => r.output.additional_context).map((r) => r.output.additional_context);
  return { allowed: true, additional_context: contexts.length > 0 ? contexts.join("\n") : undefined };
}

// ── Parliament Protocol (lazy-loaded) ─────────

/**
 * Run a full parliament session (diverge-converge + meeting log + amendments + confluence + normal form).
 * Returns null if modules unavailable.
 */
export async function runParliamentSession(request, config) {
  if (!_store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.parliamentSessionMod) return null;
  try {
    return await pMods.parliamentSessionMod.runParliamentSession(_store, request, config);
  } catch (err) {
    if (process.env.QUORUM_DEBUG) console.error("[bridge] Parliament session failed:", err.message);
    return null;
  }
}

/**
 * Check convergence status for a standing committee agenda.
 */
export async function checkParliamentConvergence(agendaId) {
  if (!_store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.meetingLogMod) return null;
  try {
    return pMods.meetingLogMod.checkConvergence(_store, agendaId);
  } catch (err) { console.warn("[bridge] checkParliamentConvergence failed:", err?.message ?? err); return null; }
}

/**
 * Propose an amendment.
 * @param {object} options - { target, change, sponsor, sponsorRole, justification }
 */
export async function proposeAmendment(options) {
  if (!_store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.amendmentMod) return null;
  try {
    return pMods.amendmentMod.proposeAmendment(_store, options);
  } catch (err) { console.warn("[bridge] proposeAmendment failed:", err?.message ?? err); return null; }
}

/**
 * Verify confluence (post-audit integrity).
 */
export async function verifyConfluence(input) {
  const pMods = await loadParliamentModules();
  if (!pMods?.confluenceMod) return null;
  try {
    return pMods.confluenceMod.verifyConfluence(input);
  } catch (err) { console.warn("[bridge] verifyConfluence failed:", err?.message ?? err); return null; }
}

/**
 * Get normal form convergence report.
 */
export async function getConvergenceReport() {
  if (!_store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.normalFormMod) return null;
  try {
    return pMods.normalFormMod.generateConvergenceReport(_store);
  } catch (err) { console.warn("[bridge] getConvergenceReport failed:", err?.message ?? err); return null; }
}

// ── Parliament Enforcement Gates ─────────────

/**
 * Check all parliament gates: amendments, verdict, confluence.
 * Returns { allowed: boolean, reason?: string } — fail-open on error.
 */
export function checkParliamentGates(options = {}) {
  if (!_store || !_modules?.parliamentGateMod) return { allowed: true };
  try {
    return _modules.parliamentGateMod.checkAllGates(_store, options);
  } catch (err) { console.warn("[bridge] checkParliamentGates failed:", err?.message ?? err); return { allowed: true }; }
}

/**
 * Check individual gates for fine-grained control.
 */
export function checkAmendmentGate() {
  if (!_store || !_modules?.parliamentGateMod) return { allowed: true };
  try { return _modules.parliamentGateMod.checkAmendmentGate(_store); }
  catch (err) { console.warn("[bridge] checkAmendmentGate failed:", err?.message ?? err); return { allowed: true }; }
}

export function checkVerdictGate() {
  if (!_store || !_modules?.parliamentGateMod) return { allowed: true };
  try { return _modules.parliamentGateMod.checkVerdictGate(_store); }
  catch (err) { console.warn("[bridge] checkVerdictGate failed:", err?.message ?? err); return { allowed: true }; }
}

export function checkConfluenceGate() {
  if (!_store || !_modules?.parliamentGateMod) return { allowed: true };
  try { return _modules.parliamentGateMod.checkConfluenceGate(_store); }
  catch (err) { console.warn("[bridge] checkConfluenceGate failed:", err?.message ?? err); return { allowed: true }; }
}

export function checkDesignGate(planningDir, trackName) {
  if (!_modules?.parliamentGateMod) return { allowed: true };
  try { return _modules.parliamentGateMod.checkDesignGate(planningDir, trackName); }
  catch (err) { console.warn("[bridge] checkDesignGate failed:", err?.message ?? err); return { allowed: true }; }
}

/**
 * Create Auditor instances from role→provider string mappings.
 * Bridges adapters/shared/parliament-runner.mjs → providers/auditors/factory.ts.
 */
export function createConsensusAuditors(roles, cwd) {
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const factoryPath = resolve(DIST, "providers", "auditors", "factory.js");
    return import(toURL(factoryPath)).then(mod =>
      mod.createConsensusAuditors(roles, cwd ?? process.cwd())
    );
  } catch (err) { console.warn("[bridge] createConsensusAuditors failed:", err?.message ?? err); return null; }
}

export function close() {
  if (_store) {
    try { _store.close(); } catch (err) { console.warn("[bridge] close failed:", err?.message ?? err); }
    _store = null;
  }
  _router = null;
  _lockService = null;
  _modules = null;
  _parliamentModules = null;
  _domainMod = null;
  _routerMod2 = null;
  _specialistMod = null;
  _messageBus = null;
  _fitnessLoop = null;
  _claimService = null;
  _stmtItemStates = null;
  _toolCoreMod = null;
  _hookRunner = null;
}
