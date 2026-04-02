/**
 * Shared types for the planning module.
 * Extracted from cli/commands/orchestrate/shared.ts — shapes match exactly.
 */

/** WB complexity tier */
export type WBSize = 'XS' | 'S' | 'M';

/** Work breakdown item — single unit of implementation work. */
export interface WorkItem {
  id: string;
  /** Human-readable title from WB heading */
  title?: string;
  targetFiles: string[];
  dependsOn?: string[];
  /** WB complexity: XS (~15-50 lines), S (~60-150), M (~180-250) */
  size?: WBSize;
  /** Concrete action steps (what to do, not "implement X") */
  action?: string;
  /** Files to read (context) and files to skip */
  contextBudget?: { read: string[]; skip: string[] };
  /** Runnable verification command */
  verify?: string;
  /** Scope boundaries — what NOT to do */
  constraints?: string;
  /** Done criteria */
  done?: string;
  /** Parent feature ID (null for top-level parents) */
  parentId?: string;
  /** Whether this is a parent (feature) or child (task) item */
  isParent?: boolean;
  /** Integration target — what this parent's scenario test verifies */
  integrationTarget?: string;
}

/** Alias for WorkItem — used in task descriptions as WBItem. */
export type WBItem = WorkItem;

/** Track reference info — discovered from docs/plans directories. */
export interface TrackInfo {
  name: string;
  path: string;
  items: number;
}

/** Plan review output — structural validation result. */
export interface PlanReviewResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

/** Wave execution group — items that can run in parallel within a phase. */
export interface Wave {
  /** Wave index (0-based, global across all phases) */
  index: number;
  /** Phase parent ID (e.g., "Phase-0") or null for orphans */
  phaseId: string | null;
  /** Items in this wave — can run in parallel */
  items: WorkItem[];
}

/** Alias for Wave — used in task descriptions as WaveGroup. */
export type WaveGroup = Wave;

/**
 * Bridge type — wraps dynamically loaded MJS bridge module.
 * Namespace-grouped methods for type safety; index signature retained for backward compat.
 */
export interface Bridge {
  [key: string]: unknown;
  init: (repoRoot: string) => Promise<boolean>;
  close: () => void;
  query: {
    getState: (key: string) => unknown;
    setState: (key: string, value: unknown) => void;
    getLatestEvidence: () => { content: string; changedFiles: string[]; timestamp: number } | null;
    getMessageBus: () => unknown;
  };
  event: {
    emitEvent: (type: string, subType: string, payload: Record<string, unknown>) => void;
    recordTransition: (entityType: string, entityId: string, fromState: string, toState: string, source: string, metadata?: Record<string, unknown>) => string | null;
    currentState: (entityType: string, entityId: string) => string | null;
    queryEvents: (filter?: Record<string, unknown>) => unknown[];
    queryItemStates: () => unknown[];
  };
  gate: {
    evaluateTrigger: (context: Record<string, unknown>) => { mode: string; tier: string; score: number; reasons: string[] } | null;
    recordVerdict: (taskKey: string, success: boolean) => { escalated: boolean; tier: string } | null;
    currentTier: (taskKey: string) => string | null;
    detectStagnation: (repoRoot: string) => { detected: boolean; patterns: unknown[]; recommendation: string } | null;
    computeFitness: (signals: unknown, config?: unknown) => unknown;
    getFitnessLoop: () => unknown;
    computeBlastRadius: (changedFiles: string[]) => Promise<{ affected: number; total: number; ratio: number; files: unknown[] } | null>;
  };
  claim: {
    claimFiles: (ownerId: string, files: string[], owner?: string, ttlMs?: number) => Array<{ filePath: string; heldBy: string }>;
    releaseFiles: (ownerId: string) => number;
    checkConflicts: (agentId: string, files: string[]) => unknown[];
    getClaims: (agentId?: string) => unknown[];
  };
  parliament: {
    runParliamentSession: (request: unknown, config: unknown) => Promise<unknown>;
    checkParliamentGates: (options?: Record<string, unknown>) => { allowed: boolean; reason?: string };
    checkAmendmentGate: () => { allowed: boolean; reason?: string };
    checkVerdictGate: () => { allowed: boolean; reason?: string };
    checkConfluenceGate: () => { allowed: boolean; reason?: string };
    checkDesignGate: (planningDir: string, trackName: string) => { allowed: boolean; reason?: string };
    createConsensusAuditors: (roles: Record<string, string>, cwd?: string) => Promise<unknown>;
    checkParliamentConvergence: (agendaId: string) => Promise<unknown>;
    proposeAmendment: (options: Record<string, unknown>) => Promise<unknown>;
    verifyConfluence: (input: unknown) => Promise<unknown>;
    getConvergenceReport: () => Promise<unknown>;
  };
  execution: {
    planExecution: (items: unknown[]) => unknown;
    selectExecutionMode: (items: unknown[]) => { mode: string; plan: { groups: unknown[]; depth: number }; maxConcurrency: number } | null;
    validatePlanClaims: (plan: unknown, agentId: string) => Map<string, unknown>;
    analyzeAuditLearnings: () => { patterns: unknown[]; suggestions: unknown[]; eventsAnalyzed: number } | null;
    createUnitOfWork: () => unknown;
  };
  agent: {
    postAgentQuery: (fromAgent: string, question: string, toAgent?: string, context?: unknown) => string | null;
    respondToAgentQuery: (queryId: string, fromAgent: string, answer: string, confidence?: number) => void;
    pollAgentQueries: (agentId: string, since?: number) => unknown[];
    getQueryResponses: (queryId: string) => unknown[];
    getAgentRoster: (trackId?: string) => unknown;
    setAgentRoster: (trackId: string, roster: unknown) => void;
  };
  hooks: {
    initHookRunner: (repoRoot: string, hooksCfg?: unknown) => Promise<unknown>;
    getHookRunner: () => unknown;
    fireHook: (event: string, input?: Record<string, unknown>) => Promise<unknown[]>;
    checkHookGate: (event: string, input?: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string; additional_context?: string }>;
  };
  domain: {
    detectDomains: (changedFiles: string[], diff: string) => Promise<unknown>;
    selectReviewers: (domains: unknown, tier: string) => Promise<unknown>;
    runSpecialistTools: (selection: unknown, evidence: unknown, cwd: string) => Promise<unknown>;
    enrichEvidence: (evidence: unknown, toolResults: unknown, opinions: unknown) => Promise<unknown>;
    parseToolFindings: (toolResult: unknown) => unknown[];
  };
  store?: any;
}

/** Minimal mux interface — methods used by orchestrate execution modules. */
export interface MuxHandle {
  spawn(opts: Record<string, unknown>): Promise<{ id: string; name: string }>;
  send(sessionId: string, input: string): boolean;
  kill(sessionId: string): Promise<void>;
  capture(sessionId: string, lines?: number): { output: string } | null;
  getBackend(): string;
}

/** Parsed heading information from a WB markdown line. */
export interface HeadingInfo {
  /** Markdown heading level (2 = ##, 3 = ###) */
  level: number;
  /** Extracted ID — e.g. "ORC-3", "Phase-1", "Step-2A" */
  id: string;
  /** Human-readable title after the ID */
  title: string;
  /** Size extracted from heading parenthetical, if present */
  size?: WBSize;
  /** True for Phase/Step parent headings */
  isParent: boolean;
}
