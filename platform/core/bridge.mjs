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

// ── Fail-safe wrappers ──────────────────────────

/** Wrap a sync function with try-catch, logging + fail-open default. */
function withFallback(fn, defaultValue, context) {
  try { return fn(); }
  catch (err) { console.warn(`[bridge] ${context} failed:`, err?.message ?? err); return defaultValue; }
}

/** Wrap an async function with try-catch, logging + fail-open default. */
async function withAsyncFallback(fn, defaultValue, context) {
  try { return await fn(); }
  catch (err) { console.warn(`[bridge] ${context} failed:`, err?.message ?? err); return defaultValue; }
}

// ── Service container ───────────────────────────
// Single object holding all lazily-initialized services.
// init() is the only creation path; services resolve on first access.

const _svc = {
  store: null,
  router: null,
  lockService: null,
  modules: null,
  parliamentModules: null,
  claimService: null,
  stmtItemStates: null,
  domainMod: null,
  routerMod2: null,
  specialistMod: null,
  messageBus: null,
  fitnessLoop: null,
  blastRadiusMod: null,
  hookRunner: null,
};

async function loadModules() {
  if (_svc.modules) return _svc.modules;
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
    _svc.modules = { storeMod, eventsMod, triggerMod, routerMod, stagnationMod, lockMod, messageBusMod, fitnessMod, fitnessLoopMod, claimMod, parallelMod, orchestratorMod, autoLearnMod, parliamentGateMod };
    return _svc.modules;
  } catch (err) {
    console.warn("[bridge] loadModules failed:", err?.message ?? err);
    return null;
  }
}

// ── Parliament lazy-load (meeting-log, amendment, confluence, normal-form, parliament-session) ──
// These 5 modules are only needed for T3 deliberative sessions, not every hook invocation.

// parliamentModules in _svc

async function loadParliamentModules() {
  if (_svc.parliamentModules) return _svc.parliamentModules;
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const [meetingLogMod, amendmentMod, confluenceMod, normalFormMod, parliamentSessionMod] = await Promise.all([
      import(toURL(resolve(DIST, "bus", "meeting-log.js"))),
      import(toURL(resolve(DIST, "bus", "amendment.js"))),
      import(toURL(resolve(DIST, "bus", "confluence.js"))),
      import(toURL(resolve(DIST, "bus", "normal-form.js"))),
      import(toURL(resolve(DIST, "bus", "parliament-session.js"))),
    ]);
    _svc.parliamentModules = { meetingLogMod, amendmentMod, confluenceMod, normalFormMod, parliamentSessionMod };
    return _svc.parliamentModules;
  } catch (err) {
    console.warn("[bridge] loadParliamentModules failed:", err?.message ?? err);
    return null;
  }
}

function getStore(repoRoot) {
  if (_svc.store) return _svc.store;
  try {
    const dbDir = resolve(repoRoot, ".claude");
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    const dbPath = resolve(dbDir, "quorum-events.db");
    // Synchronous import for store (SQLite adapter: bun:sqlite or better-sqlite3)
    const { EventStore } = _svc.modules.storeMod;
    _svc.store = new EventStore({ dbPath });
    return _svc.store;
  } catch (err) {
    console.warn("[bridge] getStore failed:", err?.message ?? err);
    return null;
  }
}

function getRouter() {
  if (_svc.router) return _svc.router;
  try {
    const { TierRouter } = _svc.modules.routerMod;
    _svc.router = new TierRouter();
    return _svc.router;
  } catch (err) {
    console.warn("[bridge] getRouter failed:", err?.message ?? err);
    return null;
  }
}

function getLockService() {
  if (_svc.lockService) return _svc.lockService;
  if (!_svc.modules || !_svc.store) return null;
  try {
    const { LockService } = _svc.modules.lockMod;
    _svc.lockService = new LockService(_svc.store.getDb());
    return _svc.lockService;
  } catch (err) {
    console.warn("[bridge] getLockService failed:", err?.message ?? err);
    return null;
  }
}

// claimService in _svc

function getClaimService() {
  if (_svc.claimService) return _svc.claimService;
  if (!_svc.modules?.claimMod || !_svc.store) return null;
  try {
    const { ClaimService } = _svc.modules.claimMod;
    _svc.claimService = new ClaimService(_svc.store.getDb());
    return _svc.claimService;
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
function emitEvent(type, source, payload = {}, meta = {}) {
  if (!_svc.modules || !_svc.store) return null;
  const { createEvent } = _svc.modules.eventsMod;
  const event = createEvent(type, source, payload, meta);
  return withFallback(() => _svc.store.append(event), null, "emitEvent");
}

/**
 * Evaluate whether this change needs audit, and at what level.
 * Returns { mode: "skip"|"simple"|"deliberative", tier, score, reasons }
 * Returns null if modules unavailable (legacy mode → always audit).
 */
function evaluateTrigger(context, learnedWeights, gateProfile) {
  if (!_svc.modules) return null;
  const { evaluateTrigger: evaluate } = _svc.modules.triggerMod;
  return evaluate(context, learnedWeights, gateProfile);
}

/**
 * Record an audit verdict result for router escalation tracking.
 * Returns { escalated, tier } or null.
 */
function recordVerdict(taskKey, success) {
  const router = getRouter();
  if (!router) return null;
  return router.recordResult(taskKey, success);
}

/**
 * Get router's current tier for a task.
 */
function currentTier(taskKey) {
  const router = getRouter();
  if (!router) return null;
  return router.currentTier(taskKey);
}

/**
 * Detect stagnation in recent audit verdicts.
 * Returns { detected, patterns, recommendation } or null.
 */
function detectStagnation(repoRoot) {
  if (!_svc.modules || !_svc.store) return null;
  const { detectStagnation: detect } = _svc.modules.stagnationMod;
  return withFallback(() => {
    const verdictEvents = _svc.store.query({ eventType: "audit.verdict", limit: 50, descending: true }).reverse();
    if (verdictEvents.length < 3) return { detected: false, patterns: [], recommendation: "continue" };
    return detect(verdictEvents, {}, undefined, { mode: "advanced" });
  }, null, "detectStagnation");
}

/**
 * Query recent events from the store.
 */
function queryEvents(filter = {}) {
  if (!_svc.store) return [];
  return withFallback(() => _svc.store.query(filter), [], "queryEvents");
}

// ── Lock management (replaces JSON lock files) ──

/**
 * Acquire a named lock atomically. No TOCTOU.
 * Returns true if acquired, false if held by another PID.
 */
function acquireLock(lockName, pid, sessionId, ttlMs) {
  const svc = getLockService();
  if (!svc) return false;
  return withFallback(() => svc.acquire(lockName, pid, sessionId, ttlMs), false, "acquireLock");
}

/**
 * Release a named lock. Only owner PID can release.
 */
function releaseLock(lockName, pid) {
  const svc = getLockService();
  if (!svc) return false;
  return withFallback(() => svc.release(lockName, pid), false, "releaseLock");
}

/**
 * Check if a lock is held.
 */
function isLockHeld(lockName) {
  const svc = getLockService();
  if (!svc) return { held: false };
  return withFallback(() => svc.isHeld(lockName), { held: false }, "isLockHeld");
}

// ── KV state (replaces JSON marker/session files) ──

/**
 * Read a KV state entry. Returns parsed JSON or null.
 */
function getState(key) {
  if (!_svc.store) return null;
  return withFallback(() => _svc.store.getKV(key), null, "getState");
}

/**
 * Write a KV state entry.
 */
function setState(key, value) {
  if (!_svc.store) return false;
  return withFallback(() => { _svc.store.setKV(key, value); return true; }, false, "setState");
}

/**
 * Get the latest submitted evidence content from KV store.
 * Returns { content, changedFiles, timestamp } or null.
 */
function getLatestEvidence() {
  return getState("evidence:latest");
}

// ── State transitions (replaces markdown tag management) ──

/**
 * Record a state transition.
 * Returns the transition ID or null on failure.
 */
function recordTransition(entityType, entityId, fromState, toState, source, metadata = {}) {
  if (!_svc.store) return null;
  return withFallback(() => {
    _svc.store.commitTransaction([], [{ entityType, entityId, fromState, toState, source, metadata }], []);
    return "ok";
  }, null, "recordTransition");
}

/**
 * Get current state for an entity.
 */
function currentState(entityType, entityId) {
  if (!_svc.store) return null;
  return withFallback(() => _svc.store.currentState(entityType, entityId), null, "currentState");
}

/**
 * Query current states for all audit items.
 * Returns array of { entityId, currentState, source, metadata, updatedAt } or empty array.
 */
// stmtItemStates in _svc
function queryItemStates() {
  if (!_svc.store) return [];
  try {
    if (!_svc.stmtItemStates) {
      _svc.stmtItemStates = _svc.store.getDb().prepare(`
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
    const rows = _svc.stmtItemStates.all();
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
function claimFiles(agentId, files, sessionId, ttlMs) {
  const svc = getClaimService();
  if (!svc) return [];
  return withFallback(() => svc.claimFiles(agentId, files, sessionId, ttlMs), [], "claimFiles");
}

/**
 * Release all file claims held by an agent.
 */
function releaseFiles(agentId) {
  const svc = getClaimService();
  if (!svc) return 0;
  return withFallback(() => svc.releaseFiles(agentId), 0, "releaseFiles");
}

/**
 * Check which files would conflict if an agent claimed them (read-only).
 */
function checkConflicts(agentId, files) {
  const svc = getClaimService();
  if (!svc) return [];
  return withFallback(() => svc.checkConflicts(agentId, files), [], "checkConflicts");
}

/**
 * Get all active file claims, optionally filtered by agent.
 */
function getClaims(agentId) {
  const svc = getClaimService();
  if (!svc) return [];
  return withFallback(() => svc.getClaims(agentId), [], "getClaims");
}

// ── Execution Planning (orchestrator + parallel planner) ──

/**
 * Plan parallel execution groups from work items.
 * Returns { groups, depth, maxWidth, unschedulable }.
 */
function planExecution(items) {
  if (!_svc.modules?.parallelMod) return null;
  return withFallback(() => _svc.modules.parallelMod.planParallel(items), null, "planExecution");
}

/**
 * Auto-select orchestration mode for work items.
 * Returns { mode, plan, reasons, maxConcurrency }.
 */
function selectExecutionMode(items) {
  if (!_svc.modules?.orchestratorMod) return null;
  return withFallback(() => _svc.modules.orchestratorMod.selectMode(items), null, "selectExecutionMode");
}

/**
 * Validate a plan against live file claims.
 */
function validatePlanClaims(plan, agentId) {
  if (!_svc.modules?.parallelMod) return new Map();
  const svc = getClaimService();
  if (!svc) return new Map();
  return withFallback(() => _svc.modules.parallelMod.validateAgainstClaims(plan, svc, agentId), new Map(), "validatePlanClaims");
}

// ── Auto-Learning (audit pattern detection) ──

/**
 * Analyze audit history for repeat patterns and generate CLAUDE.md rule suggestions.
 * Returns { patterns, suggestions, eventsAnalyzed }.
 */
function analyzeAuditLearnings() {
  if (!_svc.modules?.autoLearnMod || !_svc.store) return null;
  return withFallback(() => _svc.modules.autoLearnMod.analyzeAndSuggest(_svc.store), null, "analyzeAuditLearnings");
}

// ── TransactionalUnitOfWork factory ──

/**
 * Create a new TransactionalUnitOfWork for atomic multi-store commits.
 * Returns null if store unavailable.
 */
function createUnitOfWork() {
  if (!_svc.modules || !_svc.store) return null;
  return withFallback(() => new _svc.modules.storeMod.TransactionalUnitOfWork(_svc.store), null, "createUnitOfWork");
}

// ── Domain detection + specialist routing ────

// domainMod, routerMod2, specialistMod in _svc

async function loadDomainModules() {
  if (_svc.domainMod) return _svc;
  try {
    const toURL = (p) => pathToFileURL(p).href;
    const [dm, rm, sm] = await Promise.all([
      import(toURL(resolve(DIST, "providers", "domain-detect.js"))),
      import(toURL(resolve(DIST, "providers", "domain-router.js"))),
      import(toURL(resolve(DIST, "providers", "specialist.js"))),
    ]);
    _svc.domainMod = dm;
    _svc.routerMod2 = rm;
    _svc.specialistMod = sm;
    return _svc;
  } catch (err) {
    console.warn("[bridge] loadDomainModules failed:", err?.message ?? err);
    return null;
  }
}

/**
 * Detect active domains from changed files and diff content.
 * Returns null if modules unavailable.
 */
async function detectDomains(changedFiles, diff) {
  const mods = await loadDomainModules();
  if (!mods?.domainMod) return null;
  return withFallback(() => mods.domainMod.detectDomains(changedFiles, diff), null, "detectDomains");
}

/**
 * Select specialist reviewers based on detected domains and audit tier.
 * Returns null if modules unavailable.
 */
async function selectReviewers(domains, tier) {
  const mods = await loadDomainModules();
  if (!mods?.routerMod2) return null;
  return withFallback(() => mods.routerMod2.selectReviewers(domains, tier), null, "selectReviewers");
}

/**
 * Run specialist deterministic tools and return results.
 * Returns null if modules unavailable.
 */
async function runSpecialistTools(selection, evidence, cwd) {
  const mods = await loadDomainModules();
  if (!mods?.specialistMod) return null;
  return withAsyncFallback(() => mods.specialistMod.runSpecialistReviews(selection, evidence, cwd), null, "runSpecialistTools");
}

/**
 * Enrich evidence with specialist review section.
 * Returns original evidence if modules unavailable.
 */
async function enrichEvidence(evidence, toolResults, opinions) {
  const mods = await loadDomainModules();
  if (!mods?.specialistMod) return evidence;
  return withFallback(() => mods.specialistMod.enrichEvidence(evidence, toolResults, opinions), evidence, "enrichEvidence");
}

// ── MessageBus (finding-level communication) ─

// messageBus in _svc

/**
 * Get or create a MessageBus instance for finding-level communication.
 * Returns null if store unavailable.
 */
function getMessageBus() {
  if (!_svc.store) return null;
  if (_svc.messageBus) return _svc.messageBus;
  return withFallback(() => {
    if (_modules?.messageBusMod?.MessageBus) {
      _svc.messageBus = new _svc.modules.messageBusMod.MessageBus(_svc.store);
    }
    return _svc.messageBus;
  }, null, "getMessageBus");
}

// ── Agent Communication (query/response) ────

/** Post a query to another agent (or broadcast). Returns queryId or null. */
function postAgentQuery(fromAgent, question, toAgent, context) {
  const mb = getMessageBus();
  if (!mb) return null;
  return withFallback(() => mb.postQuery({ fromAgent, question, toAgent, context }), null, "postAgentQuery");
}

/** Respond to an agent query. */
function respondToAgentQuery(queryId, fromAgent, answer, confidence) {
  const mb = getMessageBus();
  if (!mb) return;
  withFallback(() => mb.respondToQuery({ queryId, fromAgent, answer, confidence }), undefined, "respondToAgentQuery");
}

/** Poll for queries addressed to this agent (or broadcast). */
function pollAgentQueries(agentId, since) {
  const mb = getMessageBus();
  if (!mb) return [];
  return withFallback(() => mb.pollQueries(agentId, since), [], "pollAgentQueries");
}

/** Get all responses to a specific query. */
function getQueryResponses(queryId) {
  const mb = getMessageBus();
  if (!mb) return [];
  return withFallback(() => mb.getResponses(queryId), [], "getQueryResponses");
}

/** Get the agent roster for a track. */
function getAgentRoster(trackId) {
  return getState(`agent:roster:${trackId ?? "default"}`);
}

/** Set the agent roster for a track. */
function setAgentRoster(trackId, roster) {
  return setState(`agent:roster:${trackId ?? "default"}`, roster);
}

/**
 * Parse specialist ToolResult into Finding objects.
 * Returns empty array if modules unavailable.
 */
function parseToolFindings(toolResult) {
  return withFallback(() => {
    if (_svc.specialistMod?.parseToolFindings) return _svc.specialistMod.parseToolFindings(toolResult);
    return [];
  }, [], "parseToolFindings");
}

// ── Fitness ─────────────────────────────────────

// fitnessLoop in _svc

/**
 * Get or create a FitnessLoop instance. Fail-safe: returns null if modules unavailable.
 */
function getFitnessLoop() {
  if (_svc.fitnessLoop) return _svc.fitnessLoop;
  if (!_svc.modules?.fitnessLoopMod || !_svc.store) return null;
  return withFallback(() => {
    _svc.fitnessLoop = new _svc.modules.fitnessLoopMod.FitnessLoop(_svc.store);
    return _svc.fitnessLoop;
  }, null, "getFitnessLoop");
}

/**
 * Compute a fitness score from signals. Fail-safe: returns null.
 */
function computeFitness(signals, config) {
  if (!_svc.modules?.fitnessMod) return null;
  return withFallback(() => _svc.modules.fitnessMod.computeFitness(signals, config), null, "computeFitness");
}

// ── Blast Radius ─────────────────────────────

// blastRadiusMod in _svc

/** Lazy-load blast-radius tool (cached after first call). */
async function _getBlastRadiusMod() {
  if (_svc.blastRadiusMod) return _svc.blastRadiusMod;
  const toURL = (p) => pathToFileURL(p).href;
  _svc.blastRadiusMod = await import(toURL(resolve(QUORUM_ROOT, "platform", "core", "tools", "blast-radius", "index.mjs")));
  return _svc.blastRadiusMod;
}

/**
 * Compute transitive blast radius for changed files.
 * @param {string[]} changedFiles - relative or absolute paths
 * @returns {Promise<{affected: number, total: number, ratio: number, files: any[]}|null>}
 */
async function computeBlastRadius(changedFiles) {
  return withAsyncFallback(async () => {
    const mod = await _getBlastRadiusMod();
    return mod.computeBlastRadius(process.cwd(), changedFiles.map(f => resolve(process.cwd(), f)));
  }, null, "computeBlastRadius");
}

/**
 * Close the store connection. Call at hook exit.
 */
// ── HookRunner integration ────────────────────

// hookRunner in _svc

/**
 * Initialize the HookRunner from config and/or HOOK.md.
 * Call after init() — hooks fire at audit lifecycle events.
 *
 * @param {string} repoRoot — workspace directory
 * @param {object} [hooksCfg] — hooks section from config.json (optional)
 * @returns {import("../adapters/shared/hook-runner.mjs").HookRunner|null}
 */
async function initHookRunner(repoRoot, hooksCfg) {
  if (_svc.hookRunner) return _svc.hookRunner;
  return withAsyncFallback(async () => {
    const { HookRunner } = await import("../adapters/shared/hook-runner.mjs");
    const { loadHooksFromFile, mergeHooksConfigs, hooksConfigFromJson } = await import("../adapters/shared/hook-loader.mjs");
    const fileConfig = loadHooksFromFile(repoRoot, "HOOK.md");
    const jsonConfig = hooksCfg ? hooksConfigFromJson({ hooks: hooksCfg }) : { hooks: {} };
    const merged = mergeHooksConfigs(fileConfig, jsonConfig);
    _svc.hookRunner = new HookRunner(repoRoot, merged);
    return _svc.hookRunner;
  }, null, "initHookRunner");
}

/**
 * Get the current HookRunner instance (null if not initialized).
 * @returns {import("../adapters/shared/hook-runner.mjs").HookRunner|null}
 */
function getHookRunner() {
  return _svc.hookRunner;
}

/**
 * Fire a quorum lifecycle hook event.
 * Fail-safe — returns empty array if HookRunner unavailable.
 *
 * @param {string} event — hook event name (e.g., "audit.submit", "audit.verdict", "PreToolUse")
 * @param {object} input — HookInput fields
 * @returns {Promise<import("../adapters/shared/hook-runner.mjs").HookExecutionResult[]>}
 */
async function fireHook(event, input = {}) {
  if (!_svc.hookRunner) return [];
  return withAsyncFallback(() => _svc.hookRunner.fire(event, { hook_event_name: event, ...input }), [], "fireHook");
}

/**
 * Check if any hook would deny the given event.
 * Returns { allowed: true } or { allowed: false, reason }.
 *
 * @param {string} event
 * @param {object} input
 * @returns {Promise<{ allowed: boolean, reason?: string, additional_context?: string }>}
 */
async function checkHookGate(event, input = {}) {
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
async function runParliamentSession(request, config) {
  if (!_svc.store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.parliamentSessionMod) return null;
  return withAsyncFallback(
    () => pMods.parliamentSessionMod.runParliamentSession(_svc.store, request, config),
    null, "runParliamentSession"
  );
}

/**
 * Check convergence status for a standing committee agenda.
 */
async function checkParliamentConvergence(agendaId) {
  if (!_svc.store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.meetingLogMod) return null;
  return withFallback(() => pMods.meetingLogMod.checkConvergence(_svc.store, agendaId), null, "checkParliamentConvergence");
}

/**
 * Propose an amendment.
 * @param {object} options - { target, change, sponsor, sponsorRole, justification }
 */
async function proposeAmendment(options) {
  if (!_svc.store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.amendmentMod) return null;
  return withFallback(() => pMods.amendmentMod.proposeAmendment(_svc.store, options), null, "proposeAmendment");
}

/**
 * Verify confluence (post-audit integrity).
 */
async function verifyConfluence(input) {
  const pMods = await loadParliamentModules();
  if (!pMods?.confluenceMod) return null;
  return withFallback(() => pMods.confluenceMod.verifyConfluence(input), null, "verifyConfluence");
}

/**
 * Get normal form convergence report.
 */
async function getConvergenceReport() {
  if (!_svc.store) return null;
  const pMods = await loadParliamentModules();
  if (!pMods?.normalFormMod) return null;
  return withFallback(() => pMods.normalFormMod.generateConvergenceReport(_svc.store), null, "getConvergenceReport");
}

// ── Parliament Enforcement Gates ─────────────

/**
 * Check all parliament gates: amendments, verdict, confluence.
 * Returns { allowed: boolean, reason?: string } — fail-open on error.
 */
function checkParliamentGates(options = {}) {
  if (!_svc.store || !_svc.modules?.parliamentGateMod) return { allowed: true };
  return withFallback(() => _svc.modules.parliamentGateMod.checkAllGates(_svc.store, options), { allowed: true }, "checkParliamentGates");
}

function checkAmendmentGate() {
  if (!_svc.store || !_svc.modules?.parliamentGateMod) return { allowed: true };
  return withFallback(() => _svc.modules.parliamentGateMod.checkAmendmentGate(_svc.store), { allowed: true }, "checkAmendmentGate");
}

function checkVerdictGate() {
  if (!_svc.store || !_svc.modules?.parliamentGateMod) return { allowed: true };
  return withFallback(() => _svc.modules.parliamentGateMod.checkVerdictGate(_svc.store), { allowed: true }, "checkVerdictGate");
}

function checkConfluenceGate() {
  if (!_svc.store || !_svc.modules?.parliamentGateMod) return { allowed: true };
  return withFallback(() => _svc.modules.parliamentGateMod.checkConfluenceGate(_svc.store), { allowed: true }, "checkConfluenceGate");
}

function checkDesignGate(planningDir, trackName) {
  if (!_svc.modules?.parliamentGateMod) return { allowed: true };
  return withFallback(() => _svc.modules.parliamentGateMod.checkDesignGate(planningDir, trackName), { allowed: true }, "checkDesignGate");
}

/**
 * Create Auditor instances from role→provider string mappings.
 * Bridges adapters/shared/parliament-runner.mjs → providers/auditors/factory.ts.
 */
function createConsensusAuditors(roles, cwd) {
  return withFallback(() => {
    const toURL = (p) => pathToFileURL(p).href;
    const factoryPath = resolve(DIST, "providers", "auditors", "factory.js");
    return import(toURL(factoryPath)).then(mod =>
      mod.createConsensusAuditors(roles, cwd ?? process.cwd())
    );
  }, null, "createConsensusAuditors");
}

/**
 * Run the internal pipeline (HIDE Track).
 * Lazy-loads pipeline-runner.mjs to avoid circular deps.
 * @param {string} agenda
 * @param {object} [config]
 * @param {object} [opts]
 */
async function runPipelineInternal(agenda, config, opts) {
  const mod = await import("../adapters/shared/pipeline-runner.mjs");
  const bridge = { parliament, execution, gate, event, query, hooks };
  return mod.runPipeline(agenda, config ?? {}, bridge, opts);
}

export function close() {
  if (_svc.store) {
    withFallback(() => _svc.store.close(), undefined, "close");
  }
  for (const k of Object.keys(_svc)) _svc[k] = null;
}

// ── Namespace exports (BRIDGE-2 → BRIDGE-4: flat exports removed) ─────────────────
// All functions accessible via namespaces only. init() and close() remain flat.

export const claim = { claimFiles, releaseFiles, checkConflicts, getClaims };
export const lock = { acquireLock, releaseLock, isLockHeld };
export const agent = { postAgentQuery, respondToAgentQuery, pollAgentQueries, getQueryResponses, getAgentRoster, setAgentRoster };
export const parliament = { runParliamentSession, checkParliamentConvergence, proposeAmendment, verifyConfluence, getConvergenceReport, checkParliamentGates, checkAmendmentGate, checkVerdictGate, checkConfluenceGate, checkDesignGate, createConsensusAuditors };
export const domain = { detectDomains, selectReviewers, runSpecialistTools, enrichEvidence, parseToolFindings };
export const event = { emitEvent, recordTransition, currentState, queryEvents, queryItemStates };
export const query = { getState, setState, getLatestEvidence, getMessageBus };
export const gate = { evaluateTrigger, recordVerdict, currentTier, detectStagnation, computeFitness, getFitnessLoop, computeBlastRadius };
export const hooks = { initHookRunner, getHookRunner, fireHook, checkHookGate };
export const execution = { planExecution, selectExecutionMode, validatePlanClaims, analyzeAuditLearnings, createUnitOfWork, runPipeline: runPipelineInternal };
export const fact = {
  addFact(f) { return _svc.store?.addFact(f) ?? null; },
  getFacts(filter) { return _svc.store?.getFacts(filter) ?? []; },
  promoteFact(id, status) { _svc.store?.promoteFact(id, status); },
  archiveStaleFacts(olderThanMs) { return _svc.store?.archiveStaleFacts(olderThanMs) ?? 0; },
};
