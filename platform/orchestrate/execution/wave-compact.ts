/**
 * Wave Compact — summary + bounded restore for wave/session handoff.
 *
 * Adopted from Claude Code services/compact/ patterns:
 * - autoCompact: token-based trigger → summarize + restore top N files
 * - circuitBreaker: consecutive failures → stop retrying
 * - POST_COMPACT_MAX_FILES_TO_RESTORE: bounded file restore budget
 *
 * Instead of passing the full wave log to the next wave's agents,
 * we generate a compact summary containing only:
 * 1. changedFiles — what was modified
 * 2. fitness — current quality score
 * 3. unresolvedFindings — unresolved audit issues
 * 4. topFiles — most relevant files to restore (bounded)
 * 5. nextConstraints — constraints for next wave
 *
 * @module orchestrate/execution/wave-compact
 */

// ── Types ───────────────────────────────────────────

export interface CompactSummary {
  /** Wave number that was completed. */
  waveIndex: number;
  /** Track name. */
  trackName: string;
  /** Files changed in this wave. */
  changedFiles: string[];
  /** Current fitness score (0.0 - 1.0). */
  fitness: number;
  /** Unresolved findings from audit. */
  unresolvedFindings: CompactFinding[];
  /** Top N most relevant files to restore context for next wave. */
  topFiles: TopFileEntry[];
  /** Constraints carried forward to next wave. */
  nextConstraints: string[];
  /** Whether this summary was generated or is from a fallback. */
  source: "generated" | "fallback";
  /** Timestamp of summary generation. */
  generatedAt: number;
}

export interface CompactFinding {
  /** Finding code (e.g. "type-safety", "missing-test"). */
  code: string;
  /** Severity level. */
  severity: "high" | "medium" | "low";
  /** Affected file. */
  file?: string;
  /** One-line summary. */
  summary: string;
}

export interface TopFileEntry {
  /** File path (relative to repo root). */
  path: string;
  /** Why this file is relevant for the next wave. */
  reason: string;
}

// ── Constants ───────────────────────────────────────

/** Max files to include in topFiles (bounded restore budget). */
export const MAX_RESTORE_FILES = 5;

/** Max findings to carry forward. */
export const MAX_FINDINGS = 10;

/** Max consecutive compact failures before circuit breaker trips. */
export const CIRCUIT_BREAKER_THRESHOLD = 3;

// ── Circuit Breaker ─────────────────────────────────

export interface CompactCircuitBreaker {
  /** Consecutive failure count. */
  failures: number;
  /** Whether the breaker is tripped (stop retrying). */
  tripped: boolean;
  /** Last failure reason. */
  lastError?: string;
}

/**
 * Create a fresh circuit breaker.
 */
export function createCircuitBreaker(): CompactCircuitBreaker {
  return { failures: 0, tripped: false };
}

/**
 * Record a compact failure. Trips the breaker after N consecutive failures.
 */
export function recordFailure(breaker: CompactCircuitBreaker, error: string): CompactCircuitBreaker {
  const failures = breaker.failures + 1;
  return {
    failures,
    tripped: failures >= CIRCUIT_BREAKER_THRESHOLD,
    lastError: error,
  };
}

/**
 * Record a compact success. Resets the failure counter.
 */
export function recordSuccess(breaker: CompactCircuitBreaker): CompactCircuitBreaker {
  return { failures: 0, tripped: false };
}

// ── Summary Generation ──────────────────────────────

export interface WaveCompactInput {
  /** Completed wave index. */
  waveIndex: number;
  /** Track name. */
  trackName: string;
  /** Files changed during the wave. */
  changedFiles: string[];
  /** Current fitness score. */
  fitness: number;
  /** Audit findings (full list). */
  findings: CompactFinding[];
  /** All files involved in the wave (for ranking). */
  waveFiles: string[];
  /** Previous wave's unresolved findings (for dedup). */
  previousFindings?: CompactFinding[];
  /** Explicit constraints from audit or fixer. */
  constraints?: string[];
}

/**
 * Generate a compact summary for wave handoff.
 *
 * This is a deterministic operation (no LLM call).
 * Ranks files by relevance and truncates to bounded budget.
 */
export function generateCompactSummary(input: WaveCompactInput): CompactSummary {
  // Filter to unresolved findings (high/medium priority first)
  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedFindings = [...input.findings]
    .sort((a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2))
    .slice(0, MAX_FINDINGS);

  // Rank files for restore: changed files first, then wave files by finding density
  const findingsByFile = new Map<string, number>();
  for (const f of input.findings) {
    if (f.file) findingsByFile.set(f.file, (findingsByFile.get(f.file) ?? 0) + 1);
  }

  const ranked = [...new Set([...input.changedFiles, ...input.waveFiles])]
    .map(path => ({
      path,
      score: (input.changedFiles.includes(path) ? 10 : 0)
        + (findingsByFile.get(path) ?? 0) * 3,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESTORE_FILES);

  const topFiles: TopFileEntry[] = ranked.map(r => ({
    path: r.path,
    reason: input.changedFiles.includes(r.path)
      ? `changed in wave ${input.waveIndex}`
      : `${findingsByFile.get(r.path) ?? 0} findings`,
  }));

  return {
    waveIndex: input.waveIndex,
    trackName: input.trackName,
    changedFiles: input.changedFiles,
    fitness: input.fitness,
    unresolvedFindings: sortedFindings,
    topFiles,
    nextConstraints: input.constraints ?? [],
    source: "generated",
    generatedAt: Date.now(),
  };
}

/**
 * Generate a fallback summary when compact generation fails.
 * Contains minimal info — just changed files and fitness.
 */
export function generateFallbackSummary(
  waveIndex: number, trackName: string, changedFiles: string[], fitness: number,
): CompactSummary {
  return {
    waveIndex,
    trackName,
    changedFiles,
    fitness,
    unresolvedFindings: [],
    topFiles: changedFiles.slice(0, MAX_RESTORE_FILES).map(path => ({
      path,
      reason: "changed file (fallback)",
    })),
    nextConstraints: [],
    source: "fallback",
    generatedAt: Date.now(),
  };
}

// ── RTI-1B: Compact Telemetry ─────────────────────

/**
 * Telemetry record for compact generation outcomes.
 * Used by downstream speculation and quality measurement.
 * @since RTI-1B
 */
export interface CompactTelemetryRecord {
  /** Timestamp. */
  ts: number;
  /** Track name. */
  trackName: string;
  /** Wave index. */
  waveIndex: number;
  /** Whether generation succeeded. */
  success: boolean;
  /** Whether fallback was used. */
  usedFallback: boolean;
  /** Summary size in characters. */
  summarySize: number;
  /** Number of findings carried forward. */
  findingCount: number;
  /** Number of top files restored. */
  topFileCount: number;
  /** Fitness at compact time. */
  fitness: number;
  /** Circuit breaker state at compact time. */
  circuitBreakerTripped: boolean;
  /** Duration of compact generation in ms (if measured). */
  durationMs?: number;
}

/** Callback for compact telemetry consumers. */
export type CompactTelemetryCallback = (record: CompactTelemetryRecord) => void;

/** Module-level telemetry callbacks. */
const _compactTelemetryCallbacks: CompactTelemetryCallback[] = [];

/** Register a compact telemetry callback. @since RTI-1B */
export function onCompactTelemetry(cb: CompactTelemetryCallback): void {
  _compactTelemetryCallbacks.push(cb);
}

/** Emit compact telemetry. */
function emitCompactTelemetry(
  summary: CompactSummary,
  success: boolean,
  breaker?: CompactCircuitBreaker,
  durationMs?: number,
): void {
  if (_compactTelemetryCallbacks.length === 0) return;

  const record: CompactTelemetryRecord = {
    ts: Date.now(),
    trackName: summary.trackName,
    waveIndex: summary.waveIndex,
    success,
    usedFallback: summary.source === "fallback",
    summarySize: formatCompactContext(summary).length,
    findingCount: summary.unresolvedFindings.length,
    topFileCount: summary.topFiles.length,
    fitness: summary.fitness,
    circuitBreakerTripped: breaker?.tripped ?? false,
    durationMs,
  };

  for (const cb of _compactTelemetryCallbacks) {
    try { cb(record); } catch { /* telemetry must not break compact */ }
  }
}

// ── Prompt injection ────────────────────────────────

/**
 * Format a CompactSummary as a context section for the next wave's prompt.
 * Designed to be injected before the implementer's task description.
 */
export function formatCompactContext(summary: CompactSummary): string {
  const sections: string[] = [
    `## Previous Wave Context (Wave ${summary.waveIndex} → ${summary.waveIndex + 1})`,
    "",
    `**Track:** ${summary.trackName}`,
    `**Fitness:** ${summary.fitness.toFixed(2)}`,
    `**Changed Files:** ${summary.changedFiles.length}`,
  ];

  if (summary.unresolvedFindings.length > 0) {
    sections.push("", "### Unresolved Findings");
    for (const f of summary.unresolvedFindings) {
      sections.push(`- [${f.severity}] ${f.code}: ${f.summary}${f.file ? ` (${f.file})` : ""}`);
    }
  }

  if (summary.topFiles.length > 0) {
    sections.push("", "### Key Files to Review");
    for (const f of summary.topFiles) {
      sections.push(`- \`${f.path}\` — ${f.reason}`);
    }
  }

  if (summary.nextConstraints.length > 0) {
    sections.push("", "### Constraints");
    for (const c of summary.nextConstraints) {
      sections.push(`- ${c}`);
    }
  }

  return sections.join("\n");
}
