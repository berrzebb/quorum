/**
 * Permission Rule Source Tracker — tracks where each rule came from.
 *
 * 5-tier hierarchy: policy > project > user > session > cli.
 * Higher tiers always win in conflict resolution.
 *
 * @module bus/permission-source
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir, platform } from "node:os";
import type { RuleDefinition, RuleSource } from "./permission-rules.js";

// ── Tier Priority ───────────────────────────────────

/** Tier priority (lower index = higher priority). */
const TIER_PRIORITY: readonly RuleSource[] = [
  "policy",
  "project",
  "user",
  "session",
  "cli",
];

/** Get the priority index of a source (lower = higher priority). */
export function tierPriority(source: RuleSource): number {
  const idx = TIER_PRIORITY.indexOf(source);
  return idx === -1 ? TIER_PRIORITY.length : idx;
}

// ── Display Names ───────────────────────────────────

const DISPLAY_NAMES: Record<RuleSource, string> = {
  policy: "managed policy",
  project: "project settings",
  user: "user settings",
  session: "session (runtime)",
  cli: "CLI flag",
};

/**
 * Get a human-readable display name for a rule source.
 * Used in TUI, status output, and audit logs.
 */
export function getSettingSourceDisplayName(source: RuleSource): string {
  return DISPLAY_NAMES[source] ?? source;
}

// ── Default Paths ───────────────────────────────────

/** Resolve the default path for a given tier's permission rules file. */
export function defaultRulePath(source: RuleSource, projectRoot?: string): string {
  switch (source) {
    case "policy": {
      const isWindows = platform() === "win32";
      return isWindows
        ? join(process.env.PROGRAMDATA ?? "C:\\ProgramData", "quorum", "permission-rules.json")
        : "/etc/quorum/permission-rules.json";
    }
    case "project":
      return resolve(projectRoot ?? ".", ".claude", "quorum", "permission-rules.json");
    case "user": {
      const home = homedir();
      return join(home, ".claude", "quorum", "permission-rules.json");
    }
    case "session":
    case "cli":
      return ""; // Dynamic — no file path
  }
}

// ── Rule Loading ────────────────────────────────────

/**
 * Load permission rules from a JSON file.
 *
 * Expected format:
 * ```json
 * {
 *   "rules": [
 *     { "tool": "Bash", "content": "prefix:rm", "behavior": "deny" }
 *   ]
 * }
 * ```
 *
 * Each loaded rule gets its `source` field set to the given tier.
 * Returns empty array if file doesn't exist or is invalid.
 */
export function loadRulesFromConfig(
  filePath: string,
  source: RuleSource,
): RuleDefinition[] {
  if (!filePath || !existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as { rules?: unknown[] };

    if (!Array.isArray(parsed.rules)) return [];

    const rules: RuleDefinition[] = [];
    for (const raw of parsed.rules) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;

      // Validate required fields
      if (typeof r.tool !== "string") continue;
      const behavior = r.behavior as string;
      if (behavior !== "deny" && behavior !== "allow" && behavior !== "ask") continue;

      rules.push({
        tool: r.tool,
        content: typeof r.content === "string" ? r.content : undefined,
        behavior,
        source,
        description: typeof r.description === "string" ? r.description : undefined,
      });
    }

    return rules;
  } catch {
    // Graceful failure — invalid JSON or file read error
    return [];
  }
}

// ── Source Tracker ───────────────────────────────────

/**
 * Tracks the source (tier) of each permission rule.
 *
 * Provides conflict resolution: when two rules from different tiers
 * match the same tool, the higher-tier rule wins.
 */
export class RuleSourceTracker {
  private ruleSourceMap = new Map<RuleDefinition, RuleSource>();

  /** Track a rule's source. */
  trackRule(rule: RuleDefinition, source: RuleSource): void {
    rule.source = source;
    this.ruleSourceMap.set(rule, source);
  }

  /** Get the source of a rule. */
  getSource(rule: RuleDefinition): RuleSource | undefined {
    return rule.source ?? this.ruleSourceMap.get(rule);
  }

  /**
   * Resolve a conflict between two rules.
   * Returns the rule from the higher-priority tier.
   */
  resolveConflict(ruleA: RuleDefinition, ruleB: RuleDefinition): RuleDefinition {
    const priorityA = tierPriority(ruleA.source ?? "cli");
    const priorityB = tierPriority(ruleB.source ?? "cli");
    return priorityA <= priorityB ? ruleA : ruleB;
  }

  /** Clear all tracked sources. */
  clear(): void {
    this.ruleSourceMap.clear();
  }
}

// ── Multi-Tier Rule Loader ──────────────────────────

/**
 * Load rules from all tiers and return them in priority order.
 *
 * Higher-tier rules come first so the RulesEngine evaluates them first.
 * This means a policy deny rule will match before a project allow rule.
 */
export function loadAllTierRules(
  projectRoot?: string,
  overrides?: Partial<Record<RuleSource, string>>,
): { rules: RuleDefinition[]; tracker: RuleSourceTracker } {
  const tracker = new RuleSourceTracker();
  const allRules: RuleDefinition[] = [];

  // Load in priority order (policy first)
  for (const tier of TIER_PRIORITY) {
    if (tier === "session" || tier === "cli") continue; // Dynamic — not from files

    const path = overrides?.[tier] ?? defaultRulePath(tier, projectRoot);
    const rules = loadRulesFromConfig(path, tier);

    for (const rule of rules) {
      tracker.trackRule(rule, tier);
      allRules.push(rule);
    }
  }

  return { rules: allRules, tracker };
}
