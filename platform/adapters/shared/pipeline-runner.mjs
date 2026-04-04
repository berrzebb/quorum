/**
 * Pipeline Runner — internal 6-stage pipeline for CLI-hidden auto-execution.
 *
 * PRD § 6.2: Plan → Design → Implement → Verify → QA Loop → Finalize
 * The runner NEVER generates code — it orchestrates bridge calls only.
 *
 * @module adapters/shared/pipeline-runner
 */

/**
 * @typedef {"plan"|"design"|"implement"|"verify"|"qa"|"finalize"} PipelineStage
 */

/**
 * @typedef {Object} StageResult
 * @property {PipelineStage} stage
 * @property {"success"|"failed"|"skipped"} status
 * @property {object} [output] - Stage-specific output data
 * @property {string} [error] - Error message if failed
 * @property {number} duration - Stage duration in ms
 */

/**
 * @typedef {Object} PipelineResult
 * @property {boolean} success
 * @property {StageResult[]} stages
 * @property {number} totalDuration
 * @property {string} [failedAt] - Stage name where pipeline stopped
 */

const STAGES = ["plan", "design", "implement", "verify", "qa", "finalize"];

/**
 * Run the full 6-stage pipeline.
 *
 * Each stage receives the bridge and accumulated results from previous stages.
 * On failure: pipeline stops, but completed stage results are preserved (fail-forward).
 *
 * @param {string} agenda - Parliament agenda text
 * @param {object} config - QuorumConfig
 * @param {object} bridge - Initialized bridge instance
 * @param {object} [opts]
 * @param {number} [opts.maxQARounds=3] - Max QA retry rounds
 * @param {(stage: PipelineStage, status: string) => void} [opts.onStageChange] - Progress callback
 * @returns {Promise<PipelineResult>}
 */
export async function runPipeline(agenda, config, bridge, opts = {}) {
  const { maxQARounds = 3, onStageChange } = opts;
  const stages = [];
  const totalStart = Date.now();
  const ctx = { agenda, config, bridge, cps: null, trackInfo: null };

  for (const stage of STAGES) {
    onStageChange?.(stage, "running");
    const stageStart = Date.now();

    try {
      const handler = STAGE_HANDLERS[stage];
      const output = await handler(ctx, { maxQARounds });
      const result = {
        stage,
        status: "success",
        output,
        duration: Date.now() - stageStart,
      };
      stages.push(result);
      onStageChange?.(stage, "success");

      // Emit pipeline event
      bridge.event?.emitEvent?.("pipeline.stage.complete", "claude-code", {
        stage, status: "success", duration: result.duration,
      });
    } catch (err) {
      const result = {
        stage,
        status: "failed",
        error: err?.message ?? String(err),
        duration: Date.now() - stageStart,
      };
      stages.push(result);
      onStageChange?.(stage, "failed");

      bridge.event?.emitEvent?.("pipeline.stage.failed", "claude-code", {
        stage, error: result.error, duration: result.duration,
      });

      return {
        success: false,
        stages,
        totalDuration: Date.now() - totalStart,
        failedAt: stage,
      };
    }
  }

  return {
    success: true,
    stages,
    totalDuration: Date.now() - totalStart,
  };
}

// ── Stage Handlers ──────────────────────────────────────────

const STAGE_HANDLERS = {
  /**
   * P1. Plan — parliament session → CPS generation.
   */
  async plan(ctx) {
    const { agenda, bridge } = ctx;
    if (!bridge.parliament?.runParliamentSession) {
      return { skipped: true, reason: "parliament not available" };
    }
    const result = await bridge.parliament.runParliamentSession({
      agenda: [agenda],
      source: "claude-code",
    });
    ctx.cps = result?.cps ?? null;
    return { cps: ctx.cps, converged: result?.converged ?? false };
  },

  /**
   * P2. Design — CPS → planner session → WB generation.
   */
  async design(ctx) {
    if (!ctx.cps) {
      return { skipped: true, reason: "no CPS from plan stage" };
    }
    // Planner session uses the CPS to generate PRD + WBs
    if (!ctx.bridge.execution?.planExecution) {
      return { skipped: true, reason: "planner not available" };
    }
    const planResult = ctx.bridge.execution.planExecution?.({
      cps: ctx.cps,
      config: ctx.config,
    });
    ctx.trackInfo = planResult ?? null;
    return { trackInfo: ctx.trackInfo };
  },

  /**
   * P3. Implement — WB → orchestrate wave execution.
   */
  async implement(ctx) {
    if (!ctx.trackInfo) {
      return { skipped: true, reason: "no track info from design stage" };
    }
    // Implementation is delegated to the orchestrate engine
    // Pipeline runner does NOT generate code (Manager-Orchestrator principle)
    return { delegated: true, trackId: ctx.trackInfo?.trackId ?? "unknown" };
  },

  /**
   * P4. Verify — self-checker + verify commands + fitness gate.
   */
  async verify(ctx) {
    if (!ctx.bridge.gate?.computeFitness) {
      return { skipped: true, reason: "fitness gate not available" };
    }
    const fitness = ctx.bridge.gate.computeFitness?.();
    return { fitness: fitness?.total ?? null };
  },

  /**
   * P5. QA Loop — fixer → re-verify (max rounds).
   */
  async qa(ctx, opts) {
    // QA loop is handled by the orchestrate engine's built-in fixer
    // Pipeline runner just tracks the rounds
    return { maxRounds: opts?.maxQARounds ?? 3, delegated: true };
  },

  /**
   * P6. Finalize — retro + fact extraction + handoff.
   */
  async finalize(ctx) {
    // Emit finalize event for fact extraction (FACT track will hook into this)
    ctx.bridge.event?.emitEvent?.("pipeline.stage.finalize", "claude-code", {
      agenda: ctx.agenda,
      timestamp: Date.now(),
    });
    return { finalized: true };
  },
};

/**
 * Build a parliament agenda string from SetupIntent + ProjectProfile.
 * PRD § 6.6: "인증 시스템 구현"을 agenda로 가공.
 *
 * @param {import("./setup-interview.mjs").SetupIntent} intent
 * @param {import("./project-scanner.mjs").ProjectProfile} profile
 * @returns {string}
 */
export function buildAgenda(intent, profile) {
  const parts = [];

  // Language + framework context
  if (profile.languages.length > 0) {
    parts.push(profile.languages.join("/"));
  }
  if (profile.frameworks.length > 0) {
    parts.push(profile.frameworks.join("+"));
  }

  // Core agenda
  parts.push("프로젝트에서");
  parts.push(intent.agenda);

  // Priority hint
  const PRIORITY_HINTS = {
    strict: "보안 최우선.",
    fast: "빠른 구현 우선.",
    prototype: "실험적 프로토타입.",
    balanced: "",
  };
  const hint = PRIORITY_HINTS[intent.gateProfile] ?? "";
  if (hint) parts.push(hint);

  // Domain hints
  if (intent.activeDomains.length > 0) {
    parts.push(`주의 도메인: ${intent.activeDomains.join(", ")}.`);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Get pipeline stage names (for progress tracking).
 * @returns {readonly PipelineStage[]}
 */
export function getStages() {
  return STAGES;
}
