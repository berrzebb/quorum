/**
 * Forked Child Context — parallel worker isolation.
 *
 * Adopted from Claude Code coordinator/coordinatorMode.ts:
 * - createSubagentContext() + cloneFileStateCache()
 * - Parent baseline is shared (read-only)
 * - Child overlay mutations are isolated from siblings
 *
 * Prevents parallel Wave workers from contaminating each other's
 * context (file changes, findings, state) during concurrent execution.
 *
 * @module orchestrate/execution/context-fork
 */

// ── Types ───────────────────────────────────────────

export interface ParentContext {
  /** Wave index this context was created for. */
  waveIndex: number;
  /** Track name. */
  trackName: string;
  /** Fitness at fork time (frozen). */
  fitness: number;
  /** Changed files at fork time (frozen). */
  changedFiles: readonly string[];
  /** Compact summary from previous wave (frozen). */
  compactSummary?: string;
  /** Detected domains at fork time (frozen). */
  detectedDomains: readonly string[];
  /** Agent role assigned to this fork. */
  role?: string;
  /** Arbitrary frozen state from parent. */
  frozen: Readonly<Record<string, unknown>>;
}

export interface ChildContext {
  /** Unique child ID. */
  childId: string;
  /** Reference to parent (read-only). */
  parent: Readonly<ParentContext>;
  /** Child-local overlay — mutations here don't affect parent or siblings. */
  overlay: ChildOverlay;
  /** Whether this child has been merged back to parent. */
  merged: boolean;
  /** Creation timestamp. */
  createdAt: number;
}

export interface ChildOverlay {
  /** Files changed by this child (not visible to siblings). */
  changedFiles: string[];
  /** Findings discovered by this child. */
  findings: Array<{ code: string; severity: string; summary: string; file?: string }>;
  /** Arbitrary state mutations local to this child. */
  state: Record<string, unknown>;
}

// ── Factory ─────────────────────────────────────────

/**
 * Create a parent context snapshot (frozen at fork time).
 */
export function createParentContext(input: {
  waveIndex: number;
  trackName: string;
  fitness: number;
  changedFiles: string[];
  compactSummary?: string;
  detectedDomains?: string[];
  role?: string;
  extra?: Record<string, unknown>;
}): ParentContext {
  return {
    waveIndex: input.waveIndex,
    trackName: input.trackName,
    fitness: input.fitness,
    changedFiles: Object.freeze([...input.changedFiles]),
    compactSummary: input.compactSummary,
    detectedDomains: Object.freeze([...(input.detectedDomains ?? [])]),
    role: input.role,
    frozen: Object.freeze({ ...(input.extra ?? {}) }),
  };
}

/**
 * Fork a child context from a parent.
 * The child gets its own overlay; parent is read-only.
 */
export function forkChild(parent: ParentContext, childId: string): ChildContext {
  return {
    childId,
    parent: Object.freeze({ ...parent }),
    overlay: {
      changedFiles: [],
      findings: [],
      state: {},
    },
    merged: false,
    createdAt: Date.now(),
  };
}

// ── Child operations ────────────────────────────────

/**
 * Record a file change in the child overlay.
 */
export function childAddFile(child: ChildContext, filePath: string): void {
  if (!child.overlay.changedFiles.includes(filePath)) {
    child.overlay.changedFiles.push(filePath);
  }
}

/**
 * Record a finding in the child overlay.
 */
export function childAddFinding(
  child: ChildContext,
  finding: { code: string; severity: string; summary: string; file?: string },
): void {
  child.overlay.findings.push(finding);
}

/**
 * Set arbitrary state in the child overlay.
 */
export function childSetState(child: ChildContext, key: string, value: unknown): void {
  child.overlay.state[key] = value;
}

/**
 * Get state from child overlay, falling back to parent frozen state.
 */
export function childGetState(child: ChildContext, key: string): unknown {
  if (key in child.overlay.state) return child.overlay.state[key];
  return child.parent.frozen[key];
}

// ── Merge ───────────────────────────────────────────

/**
 * Collect results from multiple children (after parallel execution).
 * Merges overlays without cross-contamination:
 * each child's overlay is independent.
 */
export function collectChildren(children: ChildContext[]): {
  allChangedFiles: string[];
  allFindings: Array<{ code: string; severity: string; summary: string; file?: string; childId: string }>;
  childStates: Record<string, Record<string, unknown>>;
} {
  const allChangedFiles = new Set<string>();
  const allFindings: Array<{ code: string; severity: string; summary: string; file?: string; childId: string }> = [];
  const childStates: Record<string, Record<string, unknown>> = {};

  for (const child of children) {
    for (const f of child.overlay.changedFiles) allChangedFiles.add(f);
    for (const finding of child.overlay.findings) {
      allFindings.push({ ...finding, childId: child.childId });
    }
    childStates[child.childId] = { ...child.overlay.state };
    child.merged = true;
  }

  return {
    allChangedFiles: [...allChangedFiles].sort(),
    allFindings,
    childStates,
  };
}
