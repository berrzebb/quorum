/**
 * PAL Router — dynamic tier escalation based on failure tracking.
 *
 * Routes audit requests to the appropriate tier (Frugal/Standard/Frontier)
 * based on task complexity and failure history.
 *
 * Escalation: 2 consecutive failures → promote to higher tier
 * Downgrade: 2 consecutive successes at promoted tier → demote back
 * Terminal: Frontier with 2+ failures → stagnation signal
 */

export type Tier = "frugal" | "standard" | "frontier";

export interface RouterConfig {
  /** Cost multiplier per tier. */
  costs?: Record<Tier, number>;
  /** Consecutive failures before escalation (default: 2). */
  escalationThreshold?: number;
  /** Consecutive successes before downgrade (default: 2). */
  downgradeThreshold?: number;
}

export interface RoutingDecision {
  tier: Tier;
  reason: string;
  complexity: ComplexityScore;
  escalated: boolean;
}

export interface ComplexityScore {
  /** 0-1 combined score. */
  total: number;
  /** Breakdown by factor. */
  factors: {
    fileCount: number;
    toolDependencies: number;
    nestingDepth: number;
  };
}

export interface TaskContext {
  /** Number of changed files. */
  changedFiles: number;
  /** Number of tool/API dependencies affected. */
  toolDependencies: number;
  /** Max nesting depth of changed code. */
  nestingDepth: number;
}

const DEFAULT_COSTS: Record<Tier, number> = {
  frugal: 1,
  standard: 10,
  frontier: 30,
};

const TIER_ORDER: Tier[] = ["frugal", "standard", "frontier"];

export class TierRouter {
  private failureCounters = new Map<string, number>();
  private successCounters = new Map<string, number>();
  private overrides = new Map<string, Tier>();
  private escalationThreshold: number;
  private downgradeThreshold: number;
  private costs: Record<Tier, number>;

  constructor(config: RouterConfig = {}) {
    this.escalationThreshold = config.escalationThreshold ?? 2;
    this.downgradeThreshold = config.downgradeThreshold ?? 2;
    this.costs = config.costs ?? DEFAULT_COSTS;
  }

  /**
   * Route a task to the appropriate tier.
   * @param taskKey - Unique key for the task pattern (e.g., track ID or scope hash)
   * @param ctx - Task context for complexity scoring
   */
  route(taskKey: string, ctx: TaskContext): RoutingDecision {
    const complexity = scoreComplexity(ctx);
    const baseTier = complexityToTier(complexity.total);
    const override = this.overrides.get(taskKey);
    const tier = override ?? baseTier;

    return {
      tier,
      reason: override ? `Escalated from ${baseTier}` : `Complexity: ${complexity.total.toFixed(2)}`,
      complexity,
      escalated: override !== undefined,
    };
  }

  /**
   * Record an audit result and update escalation state.
   * Call this after each audit verdict.
   */
  recordResult(taskKey: string, success: boolean): { escalated: boolean; tier: Tier | null } {
    if (success) {
      // Reset failure counter
      this.failureCounters.set(taskKey, 0);

      // Track consecutive successes for downgrade
      const successes = (this.successCounters.get(taskKey) ?? 0) + 1;
      this.successCounters.set(taskKey, successes);

      // Downgrade if enough consecutive successes at escalated tier
      if (successes >= this.downgradeThreshold && this.overrides.has(taskKey)) {
        const current = this.overrides.get(taskKey)!;
        const idx = TIER_ORDER.indexOf(current);
        if (idx > 0) {
          this.overrides.set(taskKey, TIER_ORDER[idx - 1]!);
        } else {
          this.overrides.delete(taskKey);
        }
        this.successCounters.set(taskKey, 0);
        return { escalated: false, tier: this.overrides.get(taskKey) ?? null };
      }

      return { escalated: false, tier: null };
    }

    // Failure path
    this.successCounters.set(taskKey, 0);
    const failures = (this.failureCounters.get(taskKey) ?? 0) + 1;
    this.failureCounters.set(taskKey, failures);

    if (failures >= this.escalationThreshold) {
      const current = this.overrides.get(taskKey) ?? "frugal";
      const idx = TIER_ORDER.indexOf(current);

      if (idx < TIER_ORDER.length - 1) {
        const newTier = TIER_ORDER[idx + 1]!;
        this.overrides.set(taskKey, newTier);
        this.failureCounters.set(taskKey, 0);
        return { escalated: true, tier: newTier };
      }

      // Already at frontier — signal terminal stagnation
      return { escalated: false, tier: "frontier" };
    }

    return { escalated: false, tier: null };
  }

  /** Get current tier override for a task. */
  currentTier(taskKey: string): Tier | null {
    return this.overrides.get(taskKey) ?? null;
  }

  /** Get cost multiplier for a tier. */
  cost(tier: Tier): number {
    return this.costs[tier];
  }

  /** Reset all escalation state. */
  reset(): void {
    this.failureCounters.clear();
    this.successCounters.clear();
    this.overrides.clear();
  }
}

// ── Complexity scoring ────────────────────────

function scoreComplexity(ctx: TaskContext): ComplexityScore {
  // File count: 30% weight, normalized 0-1 (cap at 20 files)
  const fileScore = Math.min(1, ctx.changedFiles / 20);

  // Tool dependencies: 30% weight, normalized 0-1 (cap at 5)
  const toolScore = Math.min(1, ctx.toolDependencies / 5);

  // Nesting depth: 40% weight, normalized 0-1 (cap at 5)
  const depthScore = Math.min(1, ctx.nestingDepth / 5);

  const total = fileScore * 0.3 + toolScore * 0.3 + depthScore * 0.4;

  return {
    total,
    factors: {
      fileCount: fileScore,
      toolDependencies: toolScore,
      nestingDepth: depthScore,
    },
  };
}

function complexityToTier(score: number): Tier {
  if (score < 0.4) return "frugal";
  if (score < 0.7) return "standard";
  return "frontier";
}
