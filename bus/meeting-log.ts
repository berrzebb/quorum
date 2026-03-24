/**
 * Meeting Log — accumulation, convergence detection, classification, and CPS generation.
 *
 * Implements the parliamentary session lifecycle:
 * 1. Accumulate meeting logs (N rounds of diverge-converge)
 * 2. Detect convergence (5-classification stability)
 * 3. Classify items into 5 MECE categories (gap/strength/out/buy/build)
 * 4. Generate CPS (Context-Problem-Solution) from converged logs
 *
 * Each meeting log is stored as a parliament.session.digest event in EventStore.
 * Convergence is per-agenda (standing committee) — independent tracking.
 */

import { randomUUID } from "node:crypto";
import type { EventStore } from "./store.js";
import type {
  MeetingClassification,
  ParliamentSessionDigestPayload,
  ParliamentConvergencePayload,
} from "./events.js";
import { createEvent, type QuorumEvent } from "./events.js";

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
  /** Required stable rounds for convergence (default: 2). */
  threshold: number;
  /** Delta between last two sessions (0 = identical). */
  lastDelta: number;
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
  "principles": /\b(boundar|mental.model|hallucin|human.in.the.loop|hitl|audit.trail|principle|i\/o)\b/i,
  "definitions": /\b(agent.example|agent.call|sub.?agent|context.defin|definition|terminolog)\b/i,
  "structure": /\b(hierarch|relation|parent.child|composition|inheritance|tree.struct)\b/i,
  "architecture": /\b(overview|dataflow|data.flow|api.design|protocol|system.diagram|architect)\b/i,
  "scope": /\b(in.scope|out.scope|exclude|scope.bound|mvp|defer|phase.out)\b/i,
  "research-questions": /\b(research|communicat|intent.classif|agent.cooperat|state.manage|workflow.visual|open.question)\b/i,
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
 * Store a meeting log as a parliament.session.digest event.
 */
export function storeMeetingLog(store: EventStore, log: MeetingLog): void {
  const payload: ParliamentSessionDigestPayload = {
    agendaId: log.agendaId,
    sessionType: log.sessionType,
    verdictResult: "approved",
    converged: false,
    amendmentsResolved: 0,
    confluencePassed: false,
    errorCount: 0,
    duration: 0,
  };

  const event = createEvent("parliament.session.digest", "generic", {
    ...payload,
    meetingLogId: log.id,
    registers: log.registers,
    classificationDetails: log.classifications,
    agendaId: log.agendaId,
  });
  store.append(event);
}

/**
 * Retrieve meeting logs for a specific agenda from EventStore.
 */
export function getMeetingLogs(store: EventStore, agendaId?: string): MeetingLog[] {
  const events = store.query({ eventType: "parliament.session.digest" });
  const logs: MeetingLog[] = [];

  for (const e of events) {
    if (agendaId && e.payload.agendaId !== agendaId) continue;

    logs.push({
      id: (e.payload.meetingLogId as string) ?? e.payload.snapshotId as string ?? randomUUID(),
      sessionType: e.payload.sessionType as "morning" | "afternoon",
      timestamp: e.timestamp,
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
  const logs = prefetchedLogs ?? getMeetingLogs(store, agendaId);

  if (logs.length < 2) {
    return { converged: false, stableRounds: 0, threshold, lastDelta: 1 };
  }

  // Compare consecutive logs' classification distributions
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

  return {
    converged: stableRounds >= threshold,
    stableRounds,
    threshold,
    lastDelta,
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

function countClassifications(items: ClassifiedItem[]): Record<MeetingClassification, number> {
  const counts: Record<MeetingClassification, number> = { gap: 0, strength: 0, out: 0, buy: 0, build: 0 };
  for (const item of items) {
    counts[item.classification]++;
  }
  return counts;
}

function classificationDelta(
  a: Record<MeetingClassification, number>,
  b: Record<MeetingClassification, number>,
): number {
  let delta = 0;
  for (const key of Object.keys(a) as MeetingClassification[]) {
    delta += Math.abs(a[key] - b[key]);
  }
  return delta;
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
