/**
 * Auto-Learning — detect repeat patterns from audit history and suggest CLAUDE.md rules.
 *
 * Analyzes EventStore events for recurring rejection codes and finding categories.
 * When a pattern appears 3+ times, generates a rule suggestion for CLAUDE.md.
 *
 * Triggered during retrospective to surface learnings automatically.
 */

import type { EventStore } from "./store.js";
import type {
  FindingDetectPayload,
  FindingAckPayload,
  AuditVerdictPayload,
  FindingSeverity,
} from "./events.js";
import { detectStagnation, type StagnationPattern } from "./stagnation.js";

// ── Types ────────────────────────────────────

export interface RepeatPattern {
  /** Pattern key: category or rejection code. */
  key: string;
  /** How this pattern was detected. */
  type: "category" | "rejection_code";
  /** Number of occurrences. */
  count: number;
  /** Most common severity. */
  severity: FindingSeverity;
  /** Sample descriptions (up to 3). */
  samples: string[];
  /** Files most frequently affected. */
  topFiles: string[];
  /** Was this pattern ever dismissed (false positive indicator)? */
  dismissedCount: number;
}

export interface RuleSuggestion {
  /** The pattern that triggered this suggestion. */
  pattern: RepeatPattern;
  /** Suggested rule text for CLAUDE.md. */
  ruleText: string;
  /** Confidence: higher when pattern is consistent and not dismissed. */
  confidence: number;
}

export interface StagnationLearning {
  /** File patterns associated with stagnation. */
  filePatterns: string[];
  /** Which stagnation patterns were detected. */
  stagnationTypes: StagnationPattern[];
  /** Boost to add to trigger score for matching files (0.0-0.15). */
  triggerBoost: number;
  /** Number of stagnation events in history. */
  occurrences: number;
}

export interface LearningSummary {
  patterns: RepeatPattern[];
  suggestions: RuleSuggestion[];
  /** Stagnation-based trigger adjustments. */
  stagnationLearnings: StagnationLearning[];
  /** Total events analyzed. */
  eventsAnalyzed: number;
}

// ── Thresholds ───────────────────────────────

const MIN_OCCURRENCES = 3;
const MAX_SAMPLES = 3;
const MAX_TOP_FILES = 3;

// ── Pattern Detection ────────────────────────

/**
 * Analyze EventStore for repeat patterns across audit history.
 */
export function detectRepeatPatterns(store: EventStore): RepeatPattern[] {
  const categoryStats = new Map<string, {
    count: number;
    severities: Map<FindingSeverity, number>;
    descriptions: string[];
    files: Map<string, number>;
    dismissed: number;
  }>();

  // Scan finding.detect events — build stats + ID→category map in single pass
  const detectEvents = store.query({ eventType: "finding.detect" });
  const findingCategories = new Map<string, string>();

  for (const e of detectEvents) {
    const p = e.payload as unknown as FindingDetectPayload;
    if (!p.findings) continue;

    for (const f of p.findings) {
      findingCategories.set(f.id, f.category);

      const key = f.category;
      const stat = categoryStats.get(key) ?? {
        count: 0,
        severities: new Map<FindingSeverity, number>(),
        descriptions: [] as string[],
        files: new Map<string, number>(),
        dismissed: 0,
      };

      stat.count++;
      stat.severities.set(f.severity, (stat.severities.get(f.severity) ?? 0) + 1);
      if (stat.descriptions.length < MAX_SAMPLES) {
        stat.descriptions.push(f.description.slice(0, 120));
      }
      if (f.file) {
        stat.files.set(f.file, (stat.files.get(f.file) ?? 0) + 1);
      }

      categoryStats.set(key, stat);
    }
  }

  const ackEvents = store.query({ eventType: "finding.ack" });

  for (const e of ackEvents) {
    const p = e.payload as unknown as FindingAckPayload;
    if (p.action === "dismiss") {
      const cat = findingCategories.get(p.findingId);
      if (cat && categoryStats.has(cat)) {
        categoryStats.get(cat)!.dismissed++;
      }
    }
  }

  // Also scan rejection codes from audit.verdict events
  const codeStats = new Map<string, { count: number; dismissed: number }>();
  const verdictEvents = store.query({ eventType: "audit.verdict" });
  for (const e of verdictEvents) {
    const p = e.payload as unknown as AuditVerdictPayload;
    if (p.verdict !== "changes_requested" || !p.codes) continue;
    for (const code of p.codes) {
      const stat = codeStats.get(code) ?? { count: 0, dismissed: 0 };
      stat.count++;
      codeStats.set(code, stat);
    }
  }

  // Build patterns from categories
  const patterns: RepeatPattern[] = [];

  for (const [key, stat] of categoryStats) {
    if (stat.count < MIN_OCCURRENCES) continue;

    // Find most common severity
    let topSeverity: FindingSeverity = "minor";
    let topCount = 0;
    for (const [sev, count] of stat.severities) {
      if (count > topCount) { topSeverity = sev; topCount = count; }
    }

    // Top files
    const topFiles = [...stat.files.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TOP_FILES)
      .map(([f]) => f);

    patterns.push({
      key,
      type: "category",
      count: stat.count,
      severity: topSeverity,
      samples: stat.descriptions,
      topFiles,
      dismissedCount: stat.dismissed,
    });
  }

  // Build patterns from rejection codes
  for (const [key, stat] of codeStats) {
    if (stat.count < MIN_OCCURRENCES) continue;

    patterns.push({
      key,
      type: "rejection_code",
      count: stat.count,
      severity: "major", // rejection codes are at least major
      samples: [],
      topFiles: [],
      dismissedCount: stat.dismissed,
    });
  }

  // Sort by count descending
  return patterns.sort((a, b) => b.count - a.count);
}

// ── Rule Suggestion ──────────────────────────

/**
 * Generate CLAUDE.md rule suggestions from detected patterns.
 */
export function suggestRules(patterns: RepeatPattern[]): RuleSuggestion[] {
  return patterns.map(pattern => {
    const confidence = computeConfidence(pattern);
    const ruleText = generateRuleText(pattern);

    return { pattern, ruleText, confidence };
  }).filter(s => s.confidence > 0.3); // Skip low-confidence suggestions
}

function computeConfidence(p: RepeatPattern): number {
  let score = 0.5;

  // More occurrences = higher confidence
  if (p.count >= 5) score += 0.15;
  if (p.count >= 10) score += 0.1;

  // Higher severity = more important to codify
  if (p.severity === "critical") score += 0.15;
  else if (p.severity === "major") score += 0.1;

  // High dismiss rate = likely false positive, lower confidence
  if (p.count > 0 && p.dismissedCount / p.count > 0.5) {
    score -= 0.3;
  }

  return Math.max(0, Math.min(1, score));
}

function generateRuleText(p: RepeatPattern): string {
  const lines: string[] = [];

  if (p.type === "category") {
    lines.push(`- **${p.key}**: This issue has appeared ${p.count} times.`);
    if (p.samples.length > 0) {
      lines.push(`  Examples: ${p.samples[0]}`);
    }
    if (p.topFiles.length > 0) {
      lines.push(`  Common locations: ${p.topFiles.join(", ")}`);
    }
    lines.push(`  Action: Always check for ${p.key} issues before submitting.`);
  } else {
    lines.push(`- **${p.key}**: This rejection code has triggered ${p.count} times.`);
    lines.push(`  Action: Review and address ${p.key} patterns proactively.`);
  }

  return lines.join("\n");
}

// ── Stagnation Learning ─────────────────────

/**
 * Learn from stagnation history: which file patterns cause repeated stagnation?
 * Returns trigger boost values for matching file patterns.
 */
export function learnFromStagnation(store: EventStore): StagnationLearning[] {
  const verdictEvents = store.query({ eventType: "audit.verdict" });
  if (verdictEvents.length < 3) return [];

  // Group verdicts by trackId to detect per-track stagnation
  const trackGroups = new Map<string, typeof verdictEvents>();
  for (const e of verdictEvents) {
    const track = e.trackId ?? "default";
    const group = trackGroups.get(track) ?? [];
    group.push(e);
    trackGroups.set(track, group);
  }

  const learnings: StagnationLearning[] = [];

  for (const [_track, events] of trackGroups) {
    const result = detectStagnation(events);
    if (!result.detected) continue;

    // Extract file patterns from findings related to this track
    const filePatterns = extractAffectedFiles(store, events);
    const stagnationTypes = result.patterns.map(p => p.type);
    const maxConfidence = Math.max(...result.patterns.map(p => p.confidence));

    // Boost proportional to confidence and pattern severity
    const triggerBoost = Math.min(0.15, maxConfidence * 0.15);

    learnings.push({
      filePatterns,
      stagnationTypes,
      triggerBoost,
      occurrences: result.patterns.length,
    });
  }

  return learnings;
}

/**
 * Get the stagnation-based trigger boost for a set of changed files.
 * Used by trigger.ts to auto-escalate files with stagnation history.
 */
export function getStagnationBoost(
  learnings: StagnationLearning[],
  changedFiles: string[],
): number {
  let maxBoost = 0;
  for (const learning of learnings) {
    for (const changed of changedFiles) {
      if (learning.filePatterns.some(p => changed.includes(p) || p.includes(changed))) {
        maxBoost = Math.max(maxBoost, learning.triggerBoost);
      }
    }
  }
  return maxBoost;
}

function extractAffectedFiles(store: EventStore, verdictEvents: { trackId?: string }[]): string[] {
  const trackIds = new Set(verdictEvents.map(e => e.trackId).filter(Boolean));
  const files = new Set<string>();

  // Gather files from finding.detect events in same tracks
  const findings = store.query({ eventType: "finding.detect" });
  for (const e of findings) {
    if (trackIds.size > 0 && e.trackId && !trackIds.has(e.trackId)) continue;
    const p = e.payload as unknown as FindingDetectPayload;
    if (!p.findings) continue;
    for (const f of p.findings) {
      if (f.file) files.add(f.file);
    }
  }

  return [...files].slice(0, 10); // Cap at 10 patterns
}

// ── Combined Analysis ────────────────────────

/**
 * Run full learning analysis: detect patterns → generate suggestions + stagnation learning.
 */
export function analyzeAndSuggest(store: EventStore): LearningSummary {
  const detectCount = store.count({ eventType: "finding.detect" });
  const verdictCount = store.count({ eventType: "audit.verdict" });

  const patterns = detectRepeatPatterns(store);
  const suggestions = suggestRules(patterns);
  const stagnationLearnings = learnFromStagnation(store);

  return {
    patterns,
    suggestions,
    stagnationLearnings,
    eventsAnalyzed: detectCount + verdictCount,
  };
}
