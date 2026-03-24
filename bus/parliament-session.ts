/**
 * Parliament Session Orchestrator — the glue that binds all parliamentary modules.
 *
 * Manages the full legislative session lifecycle:
 *   startSession → runDeliberation → recordLog → checkConvergence
 *   → resolveAmendments → verifyConfluence → trackNormalForm → endSession
 *
 * Fail-open: each step wraps errors so a failing step doesn't block the session.
 * All state flows through EventStore — the session itself is stateless.
 */

import type { EventStore } from "./store.js";
import type { AuditRequest } from "../providers/provider.js";
import {
  DeliberativeConsensus,
  type ConsensusConfig,
  type ConsensusVerdict,
  type DivergeConvergeOptions,
} from "../providers/consensus.js";
import {
  createMeetingLog,
  storeMeetingLog,
  checkConvergence,
  generateCPS,
  getMeetingLogs,
  type MeetingLog,
  type ConvergenceStatus,
  type CPS,
} from "./meeting-log.js";
import {
  proposeAmendment,
  resolveAmendment,
  getAmendments,
  type AmendmentResolution,
} from "./amendment.js";
import {
  verifyConfluence,
  type ConfluenceInput,
  type ConfluenceResult,
} from "./confluence.js";
import {
  generateConvergenceReport,
  type ConvergenceReport,
} from "./normal-form.js";
import { createEvent, type ProviderKind } from "./events.js";

// ── Types ────────────────────────────────────

export interface SessionConfig {
  /** Standing committee agenda ID for this session. */
  agendaId: string;
  /** Morning or afternoon session. */
  sessionType: "morning" | "afternoon";
  /** Consensus auditor configuration. */
  consensus: ConsensusConfig;
  /** Number of eligible voters for amendments. */
  eligibleVoters: number;
  /** Implementer testimony (optional). */
  implementerTestimony?: string;
  /** Confluence verification input (optional). */
  confluenceInput?: Partial<ConfluenceInput>;
  /** Max auto-proposed amendments from gap classifications (default: 5). */
  maxAutoAmendments?: number;
}

export interface SessionResult {
  /** Consensus verdict from deliberation. */
  verdict: ConsensusVerdict | null;
  /** Meeting log recorded for this session. */
  meetingLog: MeetingLog | null;
  /** Whether the agenda has converged. */
  convergence: ConvergenceStatus | null;
  /** CPS generated (only if converged). */
  cps: CPS | null;
  /** Amendment resolutions processed. */
  amendments: AmendmentResolution[];
  /** Number of amendments auto-proposed from gap classifications. */
  autoProposedAmendments: number;
  /** Confluence verification result. */
  confluence: ConfluenceResult | null;
  /** Normal form convergence report. */
  normalForm: ConvergenceReport | null;
  /** Session duration in ms. */
  duration: number;
  /** Errors encountered (fail-open, non-blocking). */
  errors: SessionError[];
}

interface SessionError {
  phase: string;
  message: string;
}

// ── Parliament Session ──────────────────────

/**
 * Run a full parliament session.
 *
 * Each phase is wrapped in try/catch — a failing phase produces an error entry
 * but does not block subsequent phases (fail-open principle).
 */
export async function runParliamentSession(
  store: EventStore,
  request: AuditRequest,
  config: SessionConfig,
): Promise<SessionResult> {
  const start = Date.now();
  const errors: SessionError[] = [];
  const maxAutoAmendments = config.maxAutoAmendments ?? 5;

  // Emit session start event
  store.append(createEvent("parliament.session.start", "generic", {
    agendaId: config.agendaId,
    sessionType: config.sessionType,
    eligibleVoters: config.eligibleVoters,
  }));

  // Phase 1: Deliberation (Diverge-Converge)
  let verdict: ConsensusVerdict | null = null;
  try {
    store.append(createEvent("parliament.debate.round", "generic", {
      agendaId: config.agendaId,
      phase: "diverge",
      status: "started",
    }));
    const consensus = new DeliberativeConsensus(config.consensus);
    const options: DivergeConvergeOptions = {};
    if (config.implementerTestimony) {
      options.implementerTestimony = config.implementerTestimony;
    }
    verdict = await consensus.runDivergeConverge(request, options);
    store.append(createEvent("parliament.debate.round", "generic", {
      agendaId: config.agendaId,
      phase: "converge",
      status: "completed",
      verdict: verdict.finalVerdict,
      opinionsCount: verdict.opinions.length,
      classificationsCount: verdict.classifications?.length ?? 0,
    }));
  } catch (err) {
    errors.push({ phase: "deliberation", message: (err as Error).message });
  }

  // Phase 2: Record meeting log
  let meetingLog: MeetingLog | null = null;
  try {
    meetingLog = createMeetingLog(
      config.sessionType,
      config.agendaId,
      verdict?.registers ?? { statusChanges: [], decisions: [], requirementChanges: [], risks: [] },
      verdict?.classifications ?? [],
      verdict?.judgeSummary ?? "No deliberation result",
    );
    storeMeetingLog(store, meetingLog);
  } catch (err) {
    errors.push({ phase: "meeting-log", message: (err as Error).message });
  }

  // Phase 3: Check convergence + emit event
  let convergence: ConvergenceStatus | null = null;
  try {
    convergence = checkConvergence(store, config.agendaId);
    store.append(createEvent("parliament.convergence", "generic", {
      agendaId: config.agendaId,
      converged: convergence.converged,
      stableRounds: convergence.stableRounds,
      threshold: convergence.threshold,
      lastDelta: convergence.lastDelta,
      convergenceScore: meetingLog?.convergenceScore ?? 0,
    }));
  } catch (err) {
    errors.push({ phase: "convergence", message: (err as Error).message });
  }

  // Phase 4: Generate CPS (only if converged) + persist
  let cps: CPS | null = null;
  if (convergence?.converged) {
    try {
      const logs = getMeetingLogs(store, config.agendaId);
      cps = generateCPS(logs);

      // Persist CPS as event + KV for fast-path reads
      store.append(createEvent("parliament.cps.generated", "generic", {
        context: cps.context,
        problem: cps.problem,
        solution: cps.solution,
        sourceLogIds: cps.sourceLogIds,
        gapCount: cps.gaps.length,
        buildCount: cps.builds.length,
        agendaId: config.agendaId,
      }));
      store.setKV("parliament.cps.latest", {
        ...cps,
        agendaId: config.agendaId,
        generatedAt: cps.generatedAt,
      });
    } catch (err) {
      errors.push({ phase: "cps", message: (err as Error).message });
    }
  }

  // Phase 4.5: Auto-propose amendments from gap classifications
  let autoProposedAmendments = 0;
  try {
    const gaps = (verdict?.classifications ?? []).filter(c => c.classification === "gap");
    for (const gap of gaps.slice(0, maxAutoAmendments)) {
      proposeAmendment(store, {
        target: "design",
        change: gap.action || gap.item,
        sponsor: "judge",
        sponsorRole: "judge",
        justification: `Gap identified in deliberation: ${gap.item}`,
      });
      autoProposedAmendments++;
    }
  } catch (err) {
    errors.push({ phase: "auto-amendment", message: (err as Error).message });
  }

  // Phase 5: Resolve pending amendments
  const amendments: AmendmentResolution[] = [];
  try {
    const pending = getAmendments(store).filter(a => a.status === "proposed");
    for (const a of pending) {
      const resolution = resolveAmendment(store, a.id, config.eligibleVoters);
      amendments.push(resolution);
    }
  } catch (err) {
    errors.push({ phase: "amendments", message: (err as Error).message });
  }

  // Phase 6: Confluence verification
  let confluence: ConfluenceResult | null = null;
  try {
    const input: ConfluenceInput = {
      ...(config.confluenceInput ?? {}),
      auditVerdict: verdict?.finalVerdict,
      cps: cps ?? undefined,
    };
    confluence = verifyConfluence(input);

    // Auto-propose amendments from confluence suggestions
    const remainingSlots = maxAutoAmendments - autoProposedAmendments;
    if (confluence.suggestedAmendments.length > 0 && remainingSlots > 0) {
      for (const sa of confluence.suggestedAmendments.slice(0, remainingSlots)) {
        proposeAmendment(store, {
          target: sa.target,
          change: sa.change,
          sponsor: "confluence",
          sponsorRole: "judge",
          justification: `Confluence ${sa.source} mismatch: ${sa.justification}`,
        });
        autoProposedAmendments++;
      }
    }
  } catch (err) {
    errors.push({ phase: "confluence", message: (err as Error).message });
  }

  // Phase 7: Normal form tracking + emit event
  let normalForm: ConvergenceReport | null = null;
  try {
    normalForm = generateConvergenceReport(store);
    if (normalForm) {
      store.append(createEvent("parliament.session.digest", "generic", {
        subType: "normal-form",
        allConverged: normalForm.allConverged,
        avgRoundsToNormalForm: normalForm.avgRoundsToNormalForm,
        providerCount: normalForm.providers.length,
        providers: normalForm.providers.map(p => ({
          provider: p.provider,
          stage: p.currentStage,
          normalFormReached: p.normalFormReached,
          totalRounds: p.totalRounds,
        })),
      }));
    }
  } catch (err) {
    errors.push({ phase: "normal-form", message: (err as Error).message });
  }

  // Emit session digest event
  store.append(createEvent("parliament.session.digest", "generic", {
    agendaId: config.agendaId,
    sessionType: config.sessionType,
    verdictResult: verdict?.finalVerdict ?? "no-verdict",
    converged: convergence?.converged ?? false,
    amendmentsResolved: amendments.length,
    confluencePassed: confluence?.passed ?? false,
    errorCount: errors.length,
    duration: Date.now() - start,
  }));

  return {
    verdict,
    meetingLog,
    convergence,
    cps,
    amendments,
    autoProposedAmendments,
    confluence,
    normalForm,
    duration: Date.now() - start,
    errors,
  };
}
