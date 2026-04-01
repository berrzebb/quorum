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
  return { ...breaker, failures: 0, tripped: false };
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
  /** RetroDigest-derived carryover items (from Dream consolidation). @since RDI-6 */
  retroCarryover?: string[];
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

  const changedSet = new Set(input.changedFiles);
  const ranked = [...new Set([...input.changedFiles, ...input.waveFiles])]
    .map(path => ({
      path,
      score: (changedSet.has(path) ? 10 : 0)
        + (findingsByFile.get(path) ?? 0) * 3,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESTORE_FILES);

  const topFiles: TopFileEntry[] = ranked.map(r => ({
    path: r.path,
    reason: changedSet.has(r.path)
      ? `changed in wave ${input.waveIndex}`
      : `${findingsByFile.get(r.path) ?? 0} findings`,
  }));

  // Merge retro carryover into constraints (RDI-6)
  const baseConstraints = input.constraints ?? [];
  const retroItems = input.retroCarryover ?? [];
  const mergedConstraints = [...baseConstraints, ...retroItems];

  return {
    waveIndex: input.waveIndex,
    trackName: input.trackName,
    changedFiles: input.changedFiles,
    fitness: input.fitness,
    unresolvedFindings: sortedFindings,
    topFiles,
    nextConstraints: mergedConstraints,
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

// ═══ RTI-5: Pluggable LLM Compact Upgrade ═══════════════════════════════

/**
 * Interface for LLM compact summarizers.
 * Implementations call an LLM to produce richer summaries than deterministic.
 * Must be pluggable — the system never depends on a specific LLM.
 * @since RTI-5
 */
export interface CompactSummarizer {
  /** Human-readable name (for telemetry/logging). */
  readonly name: string;
  /**
   * Generate an enhanced summary from the deterministic baseline.
   * Receives the deterministic summary + raw context for enrichment.
   * Must throw on failure — caller handles fallback.
   */
  summarize(
    baseline: CompactSummary,
    rawContext?: string,
  ): Promise<LlmCompactResult>;
}

/** Result from LLM compact summarizer. */
export interface LlmCompactResult {
  /** Enhanced summary text (replaces formatCompactContext output). */
  enhancedSummary: string;
  /** Learned constraints extracted by the LLM. */
  learnedConstraints: string[];
  /** Key decisions or patterns the LLM identified. */
  keyDecisions: string[];
  /** Token count of the enhanced summary (for budget tracking). */
  tokenEstimate: number;
}

/**
 * Run compact with optional LLM upgrade.
 *
 * Flow:
 * 1. Always generate deterministic summary (safety floor).
 * 2. If summarizer is provided and circuit breaker not tripped, try LLM upgrade.
 * 3. On LLM failure, fall back to deterministic (invariant: handoff never blocked).
 * 4. Emit telemetry for both paths.
 *
 * @since RTI-5
 */
export async function generateCompactWithUpgrade(
  input: WaveCompactInput,
  summarizer?: CompactSummarizer,
  breaker?: CompactCircuitBreaker,
): Promise<{ summary: CompactSummary; llmResult?: LlmCompactResult; breaker: CompactCircuitBreaker }> {
  const currentBreaker = breaker ?? createCircuitBreaker();
  const start = Date.now();

  // Step 1: Always generate deterministic (safety floor)
  const deterministicSummary = generateCompactSummary(input);

  // Step 2: Try LLM upgrade if available and breaker not tripped
  if (summarizer && !currentBreaker.tripped) {
    try {
      const rawContext = formatCompactContext(deterministicSummary);
      const llmResult = await summarizer.summarize(deterministicSummary, rawContext);

      // Merge learned constraints into summary
      const enhanced: CompactSummary = {
        ...deterministicSummary,
        nextConstraints: [
          ...deterministicSummary.nextConstraints,
          ...llmResult.learnedConstraints,
        ],
        source: "generated", // Still deterministic base, LLM enhanced
      };

      const durationMs = Date.now() - start;
      emitCompactTelemetry(enhanced, true, currentBreaker, durationMs);

      return {
        summary: enhanced,
        llmResult,
        breaker: recordSuccess(currentBreaker),
      };
    } catch (err) {
      // LLM failed — fall back to deterministic (invariant: handoff never blocked)
      const failedBreaker = recordFailure(
        currentBreaker,
        `${summarizer.name}: ${(err as Error).message}`,
      );

      const durationMs = Date.now() - start;
      emitCompactTelemetry(deterministicSummary, false, failedBreaker, durationMs);

      return {
        summary: deterministicSummary,
        breaker: failedBreaker,
      };
    }
  }

  // No summarizer or breaker tripped — return deterministic
  const durationMs = Date.now() - start;
  emitCompactTelemetry(deterministicSummary, true, currentBreaker, durationMs);

  return {
    summary: deterministicSummary,
    breaker: currentBreaker,
  };
}

// ═══ RTI-6: Bounded Session Memory Carryover ════════════════════════════

/**
 * A single memory entry carried between waves/sessions.
 * Bounded: max entries per digest, fixed token budget.
 * @since RTI-6
 */
export interface MemoryEntry {
  /** What was learned or constrained. */
  content: string;
  /** Source wave/session that produced this memory. */
  sourceWave: number;
  /** Category of the memory. */
  category: "constraint" | "learned" | "unresolved" | "decision";
  /** Importance score (0.0 - 1.0). Higher = more likely to survive pruning. */
  importance: number;
}

/**
 * Bounded memory digest for wave/session carryover.
 * This is NOT an authoritative source — it's a derived summary
 * that helps the next wave avoid repeating past mistakes.
 * @since RTI-6
 */
export interface MemoryDigest {
  /** Entries in the digest (bounded). */
  entries: MemoryEntry[];
  /** Maximum entries allowed. */
  maxEntries: number;
  /** Estimated token count of the serialized digest. */
  tokenEstimate: number;
  /** When this digest was last updated. */
  updatedAt: number;
}

/** Default memory budget. */
const MAX_MEMORY_ENTRIES = 5;
const MAX_MEMORY_TOKENS = 500;

/**
 * Create an empty memory digest.
 * @since RTI-6
 */
export function createMemoryDigest(maxEntries = MAX_MEMORY_ENTRIES): MemoryDigest {
  return {
    entries: [],
    maxEntries,
    tokenEstimate: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Add a memory entry to the digest, respecting bounds.
 * If at capacity, replaces the lowest-importance entry.
 * @since RTI-6
 */
export function addMemory(digest: MemoryDigest, entry: MemoryEntry): MemoryDigest {
  const entries = [...digest.entries];

  if (entries.length >= digest.maxEntries) {
    // Find lowest importance entry to replace
    let minIdx = 0;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].importance < entries[minIdx].importance) minIdx = i;
    }
    // Only replace if new entry is more important
    if (entry.importance > entries[minIdx].importance) {
      entries[minIdx] = entry;
    }
  } else {
    entries.push(entry);
  }

  const serialized = entries.map(e => e.content).join("\n");
  const tokenEstimate = Math.ceil(serialized.length / 4); // rough estimate

  return {
    entries,
    maxEntries: digest.maxEntries,
    tokenEstimate: Math.min(tokenEstimate, MAX_MEMORY_TOKENS),
    updatedAt: Date.now(),
  };
}

/**
 * Extract memory entries from a compact summary + LLM result.
 * This is the bridge between compact generation and memory carryover.
 * @since RTI-6
 */
export function extractMemories(
  summary: CompactSummary,
  llmResult?: LlmCompactResult,
  waveIndex?: number,
): MemoryEntry[] {
  const wave = waveIndex ?? summary.waveIndex;
  const entries: MemoryEntry[] = [];

  // Unresolved high-severity findings → "unresolved" memories
  for (const f of summary.unresolvedFindings.filter(f => f.severity === "high")) {
    entries.push({
      content: `[Wave ${wave}] Unresolved: ${f.code} — ${f.summary}`,
      sourceWave: wave,
      category: "unresolved",
      importance: 0.9,
    });
  }

  // Explicit constraints → "constraint" memories
  for (const c of summary.nextConstraints) {
    entries.push({
      content: c,
      sourceWave: wave,
      category: "constraint",
      importance: 0.8,
    });
  }

  // LLM learned constraints → "learned" memories
  if (llmResult) {
    for (const c of llmResult.learnedConstraints) {
      entries.push({
        content: c,
        sourceWave: wave,
        category: "learned",
        importance: 0.7,
      });
    }
    for (const d of llmResult.keyDecisions) {
      entries.push({
        content: d,
        sourceWave: wave,
        category: "decision",
        importance: 0.6,
      });
    }
  }

  return entries;
}

/**
 * Format memory digest as prompt context for the next wave.
 * @since RTI-6
 */
export function formatMemoryContext(digest: MemoryDigest): string {
  if (digest.entries.length === 0) return "";

  const sections = ["## Session Memory (carried from previous waves)", ""];
  for (const entry of digest.entries) {
    sections.push(`- [${entry.category}] ${entry.content}`);
  }
  return sections.join("\n");
}

// ═══ Diff-based change summary (vendor: diff-match-patch) ═══════════════

// Optional vendor: diff-match-patch for precise text diff
let _DiffMatchPatch: any = null;
try {
  const mod = await (Function('return import("diff-match-patch")')() as Promise<any>);
  _DiffMatchPatch = mod.default || mod.diff_match_patch || mod;
} catch { /* optional — fallback to line-count heuristic */ }

export interface FileDiffSummary {
  path: string;
  additions: number;
  deletions: number;
  unchanged: number;
  /** Short description: "+12 -3 lines" */
  shortStat: string;
}

/**
 * Compute a precise diff summary between two file contents.
 * Uses diff-match-patch when available, otherwise falls back to line-count heuristic.
 *
 * Useful for enriching CompactSummary.changedFiles with change magnitude.
 */
export function computeFileDiffSummary(
  path: string, oldContent: string, newContent: string,
): FileDiffSummary {
  if (_DiffMatchPatch) {
    const dmp = new _DiffMatchPatch();
    const diffs = dmp.diff_main(oldContent, newContent);
    dmp.diff_cleanupSemantic(diffs);

    let additions = 0, deletions = 0, unchanged = 0;
    for (const [op, text] of diffs) {
      const lines = (text.match(/\n/g) || []).length || 1;
      if (op === 1) additions += lines;
      else if (op === -1) deletions += lines;
      else unchanged += lines;
    }

    return {
      path, additions, deletions, unchanged,
      shortStat: `+${additions} -${deletions} lines`,
    };
  }

  // Fallback: simple line count comparison
  const oldLines = oldContent.split("\n").length;
  const newLines = newContent.split("\n").length;
  const delta = newLines - oldLines;

  return {
    path,
    additions: delta > 0 ? delta : 0,
    deletions: delta < 0 ? -delta : 0,
    unchanged: Math.min(oldLines, newLines),
    shortStat: delta >= 0 ? `+${delta} lines` : `${delta} lines`,
  };
}
