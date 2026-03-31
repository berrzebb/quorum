/**
 * Signal Gatherer — Orient + Gather Signal phases of Dream consolidation.
 *
 * Collects normalized signals from 4 sources (priority order):
 * 1. Audit history (rejection codes, repeated findings)
 * 2. Wave compact summaries (unresolved findings, constraints)
 * 3. Existing memory/index (current MemoryDigest entries)
 * 4. Narrow transcript lookup (targeted patterns only, no full reread)
 *
 * Core rule: full transcript reread is NEVER done. Only narrow lookups
 * for specific patterns (e.g., repeated error messages, confirmed decisions).
 *
 * @module core/retro/signal-gatherer
 * @since RDI-3
 */

// ── Signal Types ─────────────────────────────

/**
 * @typedef {"finding_repeat"|"constraint"|"decision"|"drift"|"prune_candidate"} SignalKind
 */

/**
 * @typedef {Object} RetroSignal
 * @property {string} source - where this signal came from (audit, compact, memory, transcript)
 * @property {SignalKind} kind - signal classification
 * @property {number} timestamp - when the signal was observed
 * @property {string} topic - subject matter (e.g., "type-safety", "missing-test")
 * @property {string} content - human-readable content
 * @property {number} weight - importance weight (0.0-1.0)
 */

/**
 * @typedef {Object} OrientContext
 * @property {string} trackName - current track
 * @property {number} waveIndex - current or latest wave
 * @property {number} sessionCount - sessions in scope
 * @property {string[]} knownTopics - topics already in memory/index
 */

/**
 * @typedef {Object} GatherResult
 * @property {OrientContext} context - orient output
 * @property {RetroSignal[]} signals - all gathered signals
 * @property {object} stats - gathering statistics
 * @property {number} stats.auditSignals
 * @property {number} stats.compactSignals
 * @property {number} stats.memorySignals
 * @property {number} stats.transcriptSignals
 * @property {number} stats.totalDeduped
 */

// ── Orient Phase ─────────────────────────────

/**
 * Orient: identify the scope and known state for consolidation.
 *
 * @param {object} input
 * @param {string} input.trackName
 * @param {number} input.waveIndex
 * @param {object[]} [input.existingMemory] - current MemoryDigest entries
 * @param {number} [input.sessionCount]
 * @returns {OrientContext}
 */
export function orient(input) {
  const knownTopics = [];
  if (input.existingMemory) {
    for (const entry of input.existingMemory) {
      if (entry.content) {
        // Extract topic from content (crude heuristic: first bracketed text or first few words)
        const match = entry.content.match(/\[([^\]]+)\]/);
        if (match) knownTopics.push(match[1].toLowerCase());
        else knownTopics.push(entry.content.slice(0, 40).toLowerCase());
      }
    }
  }

  return {
    trackName: input.trackName,
    waveIndex: input.waveIndex,
    sessionCount: input.sessionCount ?? 0,
    knownTopics,
  };
}

// ── Gather From Audit History ────────────────

/**
 * Gather signals from audit history records.
 * Detects: repeated rejection codes, persistent findings.
 *
 * @param {object[]} auditRecords - parsed JSONL entries
 * @param {OrientContext} context
 * @returns {RetroSignal[]}
 */
export function gatherFromAudit(auditRecords, context) {
  /** @type {RetroSignal[]} */
  const signals = [];

  // Count rejection code frequency
  /** @type {Map<string, number>} */
  const codeFreq = new Map();
  for (const record of auditRecords) {
    if (record.rejection_codes) {
      for (const code of record.rejection_codes) {
        codeFreq.set(code, (codeFreq.get(code) ?? 0) + 1);
      }
    }
  }

  // Repeated codes (3+ occurrences) → finding_repeat signal
  for (const [code, count] of codeFreq) {
    if (count >= 3) {
      signals.push({
        source: "audit",
        kind: /** @type {SignalKind} */ ("finding_repeat"),
        timestamp: Date.now(),
        topic: code,
        content: `Rejection code "${code}" appeared ${count} times in recent audits`,
        weight: Math.min(1.0, 0.5 + count * 0.1),
      });
    }
  }

  // Recent failures → constraint signals
  const recentFails = auditRecords.filter(r => r.verdict !== "agree" && r.verdict !== "approved");
  if (recentFails.length >= 2) {
    const failSummaries = recentFails.slice(-3).map(r => r.summary ?? r.verdict).filter(Boolean);
    if (failSummaries.length > 0) {
      signals.push({
        source: "audit",
        kind: /** @type {SignalKind} */ ("constraint"),
        timestamp: Date.now(),
        topic: "audit-failures",
        content: `${recentFails.length} recent audit failures: ${failSummaries.join("; ")}`,
        weight: 0.7,
      });
    }
  }

  return signals;
}

// ── Gather From Wave Compact ─────────────────

/**
 * Gather signals from wave compact summaries.
 * Detects: unresolved findings, carried constraints.
 *
 * @param {object[]} compactSummaries - CompactSummary objects
 * @param {OrientContext} context
 * @returns {RetroSignal[]}
 */
export function gatherFromCompact(compactSummaries, context) {
  /** @type {RetroSignal[]} */
  const signals = [];

  for (const summary of compactSummaries) {
    // High-severity unresolved findings
    if (summary.unresolvedFindings) {
      for (const finding of summary.unresolvedFindings) {
        if (finding.severity === "high" || finding.severity === "medium") {
          signals.push({
            source: "compact",
            kind: /** @type {SignalKind} */ ("finding_repeat"),
            timestamp: summary.generatedAt ?? Date.now(),
            topic: finding.code,
            content: `[Wave ${summary.waveIndex}] ${finding.severity}: ${finding.summary}${finding.file ? ` (${finding.file})` : ""}`,
            weight: finding.severity === "high" ? 0.9 : 0.6,
          });
        }
      }
    }

    // Existing constraints
    if (summary.nextConstraints) {
      for (const constraint of summary.nextConstraints) {
        signals.push({
          source: "compact",
          kind: /** @type {SignalKind} */ ("constraint"),
          timestamp: summary.generatedAt ?? Date.now(),
          topic: "wave-constraint",
          content: constraint,
          weight: 0.7,
        });
      }
    }
  }

  return signals;
}

// ── Gather From Memory ───────────────────────

/**
 * Gather signals from existing memory entries.
 * Detects: stale/duplicate memory, drift candidates.
 *
 * @param {object[]} memoryEntries - MemoryEntry objects
 * @param {OrientContext} context
 * @returns {RetroSignal[]}
 */
export function gatherFromMemory(memoryEntries, context) {
  /** @type {RetroSignal[]} */
  const signals = [];

  // Single pass: detect duplicates + stale entries
  const seen = new Map();
  for (const entry of memoryEntries) {
    const key = normalizeForDedup(entry.content);
    if (seen.has(key)) {
      signals.push({
        source: "memory",
        kind: /** @type {SignalKind} */ ("prune_candidate"),
        timestamp: Date.now(),
        topic: "duplicate-memory",
        content: `Duplicate memory entries: "${entry.content.slice(0, 60)}..."`,
        weight: 0.5,
      });
    } else {
      seen.set(key, entry);
    }

    if (entry.sourceWave != null && context.waveIndex - entry.sourceWave >= 5) {
      signals.push({
        source: "memory",
        kind: /** @type {SignalKind} */ ("prune_candidate"),
        timestamp: Date.now(),
        topic: "stale-memory",
        content: `Memory from wave ${entry.sourceWave} is ${context.waveIndex - entry.sourceWave} waves old: "${entry.content.slice(0, 60)}..."`,
        weight: 0.4,
      });
    }
  }

  return signals;
}

// ── Gather From Transcript (narrow) ──────────

/**
 * Gather signals from narrow transcript patterns.
 * NOT a full reread — only looks for specific known patterns.
 *
 * @param {string[]} transcriptLines - visible transcript lines (already filtered)
 * @param {OrientContext} context
 * @returns {RetroSignal[]}
 */
export function gatherFromTranscript(transcriptLines, context) {
  /** @type {RetroSignal[]} */
  const signals = [];

  // Single pass: detect error patterns + decision markers
  const errorPatterns = new Map();
  const decisionRe = /\b(DECISION|CONFIRMED|AGREED|RESOLVED)\b/i;
  const errorRe = /error|failed/i;

  for (const line of transcriptLines) {
    if (errorRe.test(line)) {
      const key = normalizeForDedup(line.slice(0, 80));
      errorPatterns.set(key, (errorPatterns.get(key) ?? 0) + 1);
    }
    if (decisionRe.test(line)) {
      signals.push({
        source: "transcript",
        kind: /** @type {SignalKind} */ ("decision"),
        timestamp: Date.now(),
        topic: "explicit-decision",
        content: line.slice(0, 120),
        weight: 0.7,
      });
    }
  }

  for (const [pattern, count] of errorPatterns) {
    if (count >= 2) {
      signals.push({
        source: "transcript",
        kind: /** @type {SignalKind} */ ("finding_repeat"),
        timestamp: Date.now(),
        topic: "repeated-error",
        content: `Error pattern repeated ${count}x: "${pattern.slice(0, 60)}..."`,
        weight: Math.min(0.8, 0.3 + count * 0.1),
      });
    }
  }

  return signals;
}

// ── Full Gather Pipeline ─────────────────────

/**
 * Run the full Orient + Gather pipeline.
 *
 * @param {object} input
 * @param {string} input.trackName
 * @param {number} input.waveIndex
 * @param {object[]} [input.auditRecords]
 * @param {object[]} [input.compactSummaries]
 * @param {object[]} [input.memoryEntries]
 * @param {string[]} [input.transcriptLines]
 * @param {number} [input.sessionCount]
 * @returns {GatherResult}
 */
export function gatherSignals(input) {
  const context = orient({
    trackName: input.trackName,
    waveIndex: input.waveIndex,
    existingMemory: input.memoryEntries,
    sessionCount: input.sessionCount,
  });

  const auditSignals = gatherFromAudit(input.auditRecords ?? [], context);
  const compactSignals = gatherFromCompact(input.compactSummaries ?? [], context);
  const memorySignals = gatherFromMemory(input.memoryEntries ?? [], context);
  const transcriptSignals = gatherFromTranscript(input.transcriptLines ?? [], context);

  // Merge and deduplicate
  const allSignals = [...auditSignals, ...compactSignals, ...memorySignals, ...transcriptSignals];
  const deduped = deduplicateSignals(allSignals);

  return {
    context,
    signals: deduped,
    stats: {
      auditSignals: auditSignals.length,
      compactSignals: compactSignals.length,
      memorySignals: memorySignals.length,
      transcriptSignals: transcriptSignals.length,
      totalDeduped: allSignals.length - deduped.length,
    },
  };
}

// ── Helpers ──────────────────────────────────

/**
 * Normalize text for deduplication: lowercase, collapse whitespace, strip punctuation.
 * @param {string} text
 * @returns {string}
 */
function normalizeForDedup(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Deduplicate signals by topic + kind.
 * When duplicates exist, keeps the one with higher weight.
 *
 * @param {RetroSignal[]} signals
 * @returns {RetroSignal[]}
 */
function deduplicateSignals(signals) {
  const best = new Map();
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.topic}`;
    const existing = best.get(key);
    if (!existing || signal.weight > existing.weight) {
      best.set(key, signal);
    }
  }
  return [...best.values()];
}
