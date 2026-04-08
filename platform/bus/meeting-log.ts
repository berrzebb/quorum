/**
 * Meeting Log — accumulation, convergence detection, classification, and CPS generation.
 *
 * Implements the parliamentary session lifecycle:
 * 1. Accumulate meeting logs (N rounds of diverge-converge)
 * 2. Detect convergence (5-classification stability)
 * 3. Classify items into 5 MECE categories (gap/strength/out/buy/build)
 * 4. Generate CPS (Context-Problem-Solution) from converged logs
 *
 * Each meeting log is stored as a parliament.meeting.log event in EventStore.
 * Convergence is per-agenda (standing committee) — independent tracking.
 */

import { randomUUID } from "node:crypto";
import type { EventStore } from "./store.js";
import type { MeetingClassification } from "./events.js";
import { createEvent } from "./events.js";

// ── Types ────────────────────────────────────

export interface MeetingLog {
  id: string;
  sessionType: "morning" | "afternoon";
  timestamp: number;
  agendaId: string;
  registers: {
    statusChanges: string[];
    decisions: string[];
    requirementChanges: string[];
    risks: string[];
  };
  classifications: ClassifiedItem[];
  convergenceScore: number;
  summary: string;
}

export interface ClassifiedItem {
  item: string;
  classification: MeetingClassification;
  action: string;
}

export interface ConvergenceStatus {
  converged: boolean;
  /** Number of consecutive sessions with stable classifications. */
  stableRounds: number;
  /** Number of consecutive sessions with no new items discovered. */
  noNewItemsRounds: number;
  /** Number of consecutive sessions with delta within proportional tolerance. */
  relaxedRounds: number;
  /** Required stable rounds for convergence (default: 2). */
  threshold: number;
  /** Delta between last two sessions (0 = identical). */
  lastDelta: number;
  /** Which convergence path triggered. */
  convergencePath: "exact" | "no-new-items" | "relaxed" | null;
}

export interface CPS {
  context: string;
  problem: string;
  solution: string;
  /** Source meeting log IDs that contributed. */
  sourceLogIds: string[];
  /** Items classified as 'gap'. */
  gaps: ClassifiedItem[];
  /** Items classified as 'build'. */
  builds: ClassifiedItem[];
  generatedAt: number;
}

export interface MeetingLogConfig {
  /** Consecutive stable rounds required for convergence (default: 2). */
  convergenceThreshold?: number;
}

// ── Standing Committees (6 agenda items) ────

export type StandingCommittee =
  | "principles"
  | "definitions"
  | "structure"
  | "architecture"
  | "scope"
  | "research-questions";

export const STANDING_COMMITTEES: Record<StandingCommittee, { name: string; items: string[] }> = {
  "principles": { name: "Principles", items: ["I/O Boundaries", "User Mental Model", "No Hallucination", "HITL", "Audit Trail"] },
  "definitions": { name: "Definitions", items: ["Agent Examples", "Agent Call", "Sub Agent", "Context"] },
  "structure": { name: "Structure", items: ["Hierarchy", "Relation"] },
  "architecture": { name: "Architecture", items: ["Overview", "Dataflow"] },
  "scope": { name: "Scope", items: ["In Scope", "Out Scope"] },
  "research-questions": { name: "Research Questions", items: ["Requirements", "Communication Protocol", "Intent Classification", "Agent Cooperation", "State Management", "Workflow Visualization"] },
};

export const COMMITTEE_IDS = Object.keys(STANDING_COMMITTEES) as StandingCommittee[];

// ── Committee Routing ────────────────────────

const COMMITTEE_PATTERNS: Record<StandingCommittee, RegExp> = {
  "principles": /\b(boundar|mental.model|hallucin|human.in.the.loop|hitl|audit.trail|principle|i\/o)\b|원칙|경계|감사.?추적/i,
  "definitions": /\b(agent.example|agent.call|sub.?agent|context.defin|definition|terminolog)\b|정의|용어|에이전트.?정의/i,
  "structure": /\b(hierarch|relation|parent.child|composition|inheritance|tree.struct)\b|구조|계층|관계/i,
  "architecture": /\b(overview|dataflow|data.flow|api|protocol|system.diagram|architect|build|implement)\b|아키텍처|설계|구축|플랫폼|시스템|데이터.?흐름/i,
  "scope": /\b(in.scope|out.scope|exclude|scope.bound|mvp|defer|phase.out)\b|범위|스코프|MVP|제외|포함/i,
  "research-questions": /\b(research|communicat|intent.classif|agent.cooperat|state.manage|workflow.visual|open.question)\b|연구|조사|수집|통신|프로토콜/i,
};

const COMMITTEE_ENTRIES = Object.entries(COMMITTEE_PATTERNS) as Array<[StandingCommittee, RegExp]>;

/**
 * Route a topic to the appropriate standing committee(s) by keyword matching.
 * Returns multiple committees if topic spans concerns.
 */
export function routeToCommittee(topic: string): StandingCommittee[] {
  const matches: StandingCommittee[] = [];
  for (const [committee, pattern] of COMMITTEE_ENTRIES) {
    if (pattern.test(topic)) {
      matches.push(committee);
    }
  }
  // Fallback: unmatched topics go to research-questions
  return matches.length > 0 ? matches : ["research-questions"];
}

// ── Core Functions ───────────────────────────

const DEFAULT_CONVERGENCE_THRESHOLD = 2;

/**
 * Create a meeting log from a consensus session's output.
 */
export function createMeetingLog(
  sessionType: "morning" | "afternoon",
  agendaId: string,
  registers: MeetingLog["registers"],
  classifications: ClassifiedItem[],
  summary: string,
): MeetingLog {
  return {
    id: randomUUID(),
    sessionType,
    timestamp: Date.now(),
    agendaId,
    registers,
    classifications,
    convergenceScore: computeConvergenceScore(classifications),
    summary,
  };
}

/**
 * Store a meeting log as a parliament.meeting.log event.
 */
export function storeMeetingLog(store: EventStore, log: MeetingLog): void {
  const event = createEvent("parliament.meeting.log", "generic", {
    meetingLogId: log.id,
    agendaId: log.agendaId,
    sessionType: log.sessionType,
    registers: log.registers,
    classificationDetails: log.classifications,
    convergenceScore: log.convergenceScore,
    logTimestamp: log.timestamp,
  });
  store.append(event);
}

/**
 * Retrieve meeting logs for a specific agenda from EventStore.
 */
export function getMeetingLogs(store: EventStore, agendaId?: string): MeetingLog[] {
  const events = store.query({ eventType: "parliament.meeting.log" });
  const logs: MeetingLog[] = [];

  for (const e of events) {
    if (agendaId && e.payload.agendaId !== agendaId) continue;

    logs.push({
      id: (e.payload.meetingLogId as string) ?? e.payload.snapshotId as string ?? randomUUID(),
      sessionType: e.payload.sessionType as "morning" | "afternoon",
      timestamp: (e.payload.logTimestamp as number) ?? e.timestamp,
      agendaId: (e.payload.agendaId as string) ?? "default",
      registers: (e.payload.registers as MeetingLog["registers"]) ?? { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      classifications: (e.payload.classificationDetails as ClassifiedItem[]) ?? [],
      convergenceScore: (e.payload.convergenceScore as number) ?? 0,
      summary: (e.payload.summary as string) ?? "",
    });
  }

  return logs.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Check convergence for a specific agenda.
 * Convergence = 5-classification distribution stable for N consecutive rounds.
 */
export function checkConvergence(
  store: EventStore,
  agendaId: string,
  config?: MeetingLogConfig,
  prefetchedLogs?: MeetingLog[],
): ConvergenceStatus {
  const threshold = config?.convergenceThreshold ?? DEFAULT_CONVERGENCE_THRESHOLD;
  const rawLogs = prefetchedLogs ?? getMeetingLogs(store, agendaId);

  // Filter out noise logs caused by parse-fallback:
  // - Fewer than 3 classifications (likely incomplete parse)
  // - Item count dropped >50% from previous log (parse failure lost items)
  const logs = filterNoiseLogs(rawLogs);

  if (logs.length < 2) {
    return { converged: false, stableRounds: 0, noNewItemsRounds: 0, relaxedRounds: 0, threshold, lastDelta: 1, convergencePath: null };
  }

  // ── Path 1: Exact classification distribution match ──
  let stableRounds = 0;
  let lastDelta = 1;

  for (let i = logs.length - 1; i > 0; i--) {
    const curr = countClassifications(logs[i]!.classifications);
    const prev = countClassifications(logs[i - 1]!.classifications);
    const delta = classificationDelta(curr, prev);
    lastDelta = delta;

    if (delta === 0) {
      stableRounds++;
    } else {
      break;
    }
  }

  // ── Path 2: No-new-items (greenfield convergence) ──
  // If the item set in round N has at most minor growth from round N-1,
  // the deliberation has stabilized even if classifications shift.
  // Allow up to 20% new items per round — LLMs rephrase/split items non-deterministically.
  let noNewItemsRounds = 0;

  for (let i = logs.length - 1; i > 0; i--) {
    const currItems = new Set(logs[i]!.classifications.map(c => normalizeItemKey(c.item)));
    const prevItems = new Set(logs[i - 1]!.classifications.map(c => normalizeItemKey(c.item)));
    const newItems = [...currItems].filter(item => !prevItems.has(item));
    const maxNewItems = Math.floor(prevItems.size * 0.2);

    if (newItems.length <= maxNewItems && currItems.size > 0) {
      noNewItemsRounds++;
    } else {
      break;
    }
  }

  // ── Path 3: Relaxed delta (proportional tolerance) ──
  // LLM non-determinism causes item count fluctuations even when semantically stable.
  // Allow delta within 50% of total item count (min 3), plus half the item growth.
  // Use sliding window: count relaxed rounds in last N transitions (not consecutive).
  // This handles LLM jitter where delta oscillates around the tolerance boundary.
  let relaxedRounds = 0;
  const windowSize = Math.min(logs.length - 1, 4); // Check last 4 transitions

  for (let i = logs.length - 1; i > 0 && i >= logs.length - windowSize; i--) {
    const curr = countClassifications(logs[i]!.classifications);
    const prev = countClassifications(logs[i - 1]!.classifications);
    const delta = classificationDelta(curr, prev);
    const totalItems = Math.max(
      logs[i]!.classifications.length,
      logs[i - 1]!.classifications.length,
      1,
    );
    const itemGrowth = Math.abs(logs[i]!.classifications.length - logs[i - 1]!.classifications.length);
    const tolerance = Math.max(3, Math.floor(totalItems * 0.3) + Math.floor(itemGrowth * 0.5));

    if (delta <= tolerance && logs[i]!.classifications.length > 0) {
      relaxedRounds++;
    }
    // No break — count all qualifying rounds in the window
  }

  // Empty classifications (e.g. from parse failures) must NOT count as converged.
  // Require at least one classification item in the latest log.
  const latestHasContent = logs[logs.length - 1]!.classifications.length > 0;

  const exactConverged = stableRounds >= threshold && latestHasContent;
  const noNewItemsConverged = noNewItemsRounds >= threshold && latestHasContent;
  const relaxedConverged = relaxedRounds >= threshold && latestHasContent;
  const converged = exactConverged || noNewItemsConverged || relaxedConverged;

  return {
    converged,
    stableRounds,
    noNewItemsRounds,
    relaxedRounds,
    threshold,
    lastDelta,
    convergencePath: converged
      ? (exactConverged ? "exact" : noNewItemsConverged ? "no-new-items" : "relaxed")
      : null,
  };
}

/**
 * Generate a CPS (Context-Problem-Solution) from converged meeting logs.
 * Only called after convergence is detected.
 */
export function generateCPS(logs: MeetingLog[]): CPS {
  // Aggregate all items across logs
  const allItems = logs.flatMap(l => l.classifications);
  const gaps = allItems.filter(i => i.classification === "gap");
  const builds = allItems.filter(i => i.classification === "build");

  // Context: aggregate status changes and decisions
  const allStatusChanges = [...new Set(logs.flatMap(l => l.registers.statusChanges))];
  const allDecisions = [...new Set(logs.flatMap(l => l.registers.decisions))];
  const allRisks = [...new Set(logs.flatMap(l => l.registers.risks))];

  const context = allStatusChanges.length > 0
    ? `Current state: ${allStatusChanges.join("; ")}. Decisions made: ${allDecisions.join("; ")}.`
    : "No prior context established.";

  const problem = gaps.length > 0
    ? `Identified gaps: ${gaps.map(g => g.item).join("; ")}.${allRisks.length > 0 ? ` Risks: ${allRisks.join("; ")}.` : ""}`
    : "No gaps identified.";

  const solution = builds.length > 0
    ? `Must build: ${builds.map(b => `${b.item} (${b.action})`).join("; ")}.`
    : "No build items identified.";

  return {
    context,
    problem,
    solution,
    sourceLogIds: logs.map(l => l.id),
    gaps,
    builds,
    generatedAt: Date.now(),
  };
}

// ── Helpers ──────────────────────────────────

/**
 * Remove noise logs caused by parse-fallback (mux NDJSON parsing failures).
 * A log is noise only if its item count dropped significantly from the previous good log,
 * indicating a parse failure lost classifications. Small but consistent logs are kept.
 */
function filterNoiseLogs(logs: MeetingLog[]): MeetingLog[] {
  if (logs.length <= 1) return logs;
  const filtered: MeetingLog[] = [logs[0]!];
  for (let i = 1; i < logs.length; i++) {
    const curr = logs[i]!;
    const prev = filtered[filtered.length - 1]!;
    // Skip only if BOTH conditions met: significant drop AND previous had substantial content
    // This preserves small-but-consistent logs (e.g., 2 items throughout)
    if (prev.classifications.length >= 5 && curr.classifications.length < prev.classifications.length * 0.5) continue;
    filtered.push(curr);
  }
  return filtered;
}

const KNOWN_CLASSIFICATIONS: readonly MeetingClassification[] = ["gap", "strength", "out", "buy", "build"] as const;

function countClassifications(items: ClassifiedItem[]): Record<MeetingClassification, number> {
  const counts: Record<MeetingClassification, number> = { gap: 0, strength: 0, out: 0, buy: 0, build: 0 };
  for (const item of items) {
    // Guard: skip unknown classifications to prevent NaN poisoning
    if (KNOWN_CLASSIFICATIONS.includes(item.classification)) {
      counts[item.classification]++;
    }
  }
  return counts;
}

function classificationDelta(
  a: Record<MeetingClassification, number>,
  b: Record<MeetingClassification, number>,
): number {
  let delta = 0;
  // Use known keys only — Object.keys(a) could include NaN-poisoned unknown keys
  for (const key of KNOWN_CLASSIFICATIONS) {
    delta += Math.abs((a[key] ?? 0) - (b[key] ?? 0));
  }
  return delta;
}

/**
 * Normalize an item name for set comparison across rounds.
 * LLMs may rephrase the same concept differently — normalize to lowercase,
 * collapse whitespace, strip articles/punctuation for fuzzy matching.
 */
function normalizeItemKey(item: string): string {
  return item
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")  // strip punctuation (Unicode-safe)
    .replace(/\s+/g, " ")
    .trim();
}

function computeConvergenceScore(items: ClassifiedItem[]): number {
  if (items.length === 0) return 0;
  // Higher score when items are clearly classified (not all in one bucket)
  const counts = countClassifications(items);
  const total = items.length;
  const entropy = Object.values(counts)
    .filter(c => c > 0)
    .reduce((sum, c) => {
      const p = c / total;
      return sum - p * Math.log2(p);
    }, 0);
  // Normalize: max entropy for 5 categories = log2(5) ≈ 2.32
  return Math.min(1, entropy / 2.32);
}
