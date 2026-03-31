/**
 * HookRunner ↔ adapter hook interface bridge.
 *
 * Ported from SoulFlow-Orchestrator src/hooks/bridge.ts.
 * Converts HookRunner fire() results into adapter-compatible decisions.
 *
 * Each adapter's hook scripts can use these to delegate to user-defined hooks:
 * - Claude Code: PreToolUse/PostToolUse scripts call hookRunnerToPreToolHook/hookRunnerToPostToolHook
 * - Gemini: BeforeTool/AfterTool scripts call the same
 * - Codex: file-watch adapter can use hookRunnerToAuditGate
 *
 * @module adapters/shared/hook-bridge
 */

/**
 * Convert HookRunner into a pre-tool gate function.
 * Fires PreToolUse hooks; returns { decision, reason?, updated_input? }.
 *
 * @param {import("./hook-runner.mjs").HookRunner} runner
 * @param {string} [sessionId]
 * @returns {(toolName: string, params: Record<string, unknown>, cwd?: string) => Promise<{ decision: "allow"|"deny"|"ignore", reason?: string, updated_input?: Record<string, unknown> }>}
 */
export function hookRunnerToPreToolHook(runner, sessionId) {
  return async (toolName, params, cwd) => {
    if (!runner.has("PreToolUse")) return { decision: "allow" };

    const results = await runner.fire("PreToolUse", {
      hook_event_name: "PreToolUse",
      session_id: sessionId,
      cwd,
      tool_name: toolName,
      tool_input: params,
    });

    // Deny takes priority — check all results first
    for (const r of results) {
      if (r.output.decision === "deny") {
        return {
          decision: "deny",
          reason: r.output.reason || `blocked by hook: ${r.hook_name}`,
        };
      }
    }
    // Then check for updated_input
    for (const r of results) {
      if (r.output.updated_input) {
        return { decision: "allow", updated_input: r.output.updated_input };
      }
    }
    return { decision: "allow" };
  };
}

/**
 * Convert HookRunner into a post-tool handler function.
 * Fires PostToolUse or PostToolUseFailure hooks.
 *
 * @param {import("./hook-runner.mjs").HookRunner} runner
 * @param {string} [sessionId]
 * @returns {(toolName: string, params: Record<string, unknown>, result: string, cwd?: string, isError?: boolean) => Promise<void>}
 */
export function hookRunnerToPostToolHook(runner, sessionId) {
  return async (toolName, params, result, cwd, isError) => {
    const event = isError ? "PostToolUseFailure" : "PostToolUse";
    if (!runner.has(event)) return;

    await runner.fire(event, {
      hook_event_name: event,
      session_id: sessionId,
      tool_name: toolName,
      tool_input: params,
      tool_output: result,
      is_error: isError,
      cwd,
    });
  };
}

/**
 * Convert HookRunner into an audit gate function.
 * Fires a custom quorum event and returns aggregated decision.
 * Useful for quorum-specific lifecycle events (audit.submit, audit.verdict, etc.).
 *
 * @param {import("./hook-runner.mjs").HookRunner} runner
 * @param {string} event — quorum event name (e.g., "audit.submit", "audit.verdict")
 * @param {string} [sessionId]
 * @returns {(metadata?: Record<string, unknown>) => Promise<{ decision: "allow"|"deny"|"ignore", reason?: string, additional_context?: string }>}
 */
export function hookRunnerToAuditGate(runner, event, sessionId) {
  return async (metadata) => {
    if (!runner.has(event)) return { decision: "allow" };

    const results = await runner.fire(event, {
      hook_event_name: event,
      session_id: sessionId,
      metadata,
    });

    for (const r of results) {
      if (r.output.decision === "deny") {
        return {
          decision: "deny",
          reason: r.output.reason || `blocked by hook: ${r.hook_name}`,
          additional_context: r.output.additional_context,
        };
      }
    }

    // Collect additional_context from all allow/ignore results
    const contexts = results
      .filter((r) => r.output.additional_context)
      .map((r) => r.output.additional_context);

    return {
      decision: "allow",
      additional_context: contexts.length > 0 ? contexts.join("\n") : undefined,
    };
  };
}

/**
 * Convert HookRunner into a stop-review gate function.
 *
 * Integrates codex-plugin-cc's Stop-review-gate pattern into quorum's
 * hook chain. When a Stop event fires, this gate:
 * 1. Checks quorum's fitness score (if available via metadata)
 * 2. Delegates to codex-plugin-cc's adversarial review (if available)
 * 3. Returns BLOCK if fitness < threshold OR review found issues
 *
 * @param {import("./hook-runner.mjs").HookRunner} runner
 * @param {string} [sessionId]
 * @param {{ fitnessThreshold?: number }} [options]
 * @returns {(metadata?: Record<string, unknown>) => Promise<{ decision: "block"|"allow", reason?: string }>}
 */
export function hookRunnerToStopReviewGate(runner, sessionId, options = {}) {
  const fitnessThreshold = options.fitnessThreshold ?? 0.7;

  return async (metadata) => {
    const fitness = metadata?.fitness;

    // Gate 1: Fitness score check (purely mechanical)
    if (typeof fitness === "number" && fitness < fitnessThreshold) {
      return {
        decision: "block",
        reason: `Fitness score ${fitness.toFixed(2)} below threshold ${fitnessThreshold}. Run \`quorum verify\` to check quality gates.`,
      };
    }

    // Gate 2: Fire Stop hooks (including any codex-plugin-cc stop-review-gate)
    if (runner.has("Stop")) {
      const results = await runner.fire("Stop", {
        hook_event_name: "Stop",
        session_id: sessionId,
        metadata,
      });

      for (const r of results) {
        if (r.output.decision === "block" || r.output.decision === "deny") {
          return {
            decision: "block",
            reason: r.output.reason || `Blocked by stop review gate: ${r.hook_name}`,
          };
        }
      }
    }

    return { decision: "allow" };
  };
}

/**
 * Merge hook configurations from multiple sources (quorum + plugins).
 *
 * Ensures quorum hooks fire before plugin hooks for the same event.
 * This preserves governance priority: quorum gates first, plugin gates second.
 *
 * @param {Record<string, Array>} primary — quorum hooks (high priority)
 * @param {Record<string, Array>} secondary — plugin hooks (lower priority)
 * @returns {Record<string, Array>} — merged hooks config
 */
export function mergeHookConfigs(primary, secondary) {
  if (!primary || typeof primary !== "object") return secondary ?? {};
  if (!secondary || typeof secondary !== "object") return { ...primary };
  const merged = { ...primary };
  for (const [event, hooks] of Object.entries(secondary)) {
    if (!Array.isArray(hooks)) continue;
    if (Array.isArray(merged[event])) {
      merged[event] = [...merged[event], ...hooks];
    } else {
      merged[event] = hooks;
    }
  }
  return merged;
}

/**
 * Build a standard HookInput from quorum adapter context.
 * Normalizes adapter-specific field names to the canonical format.
 *
 * @param {object} params
 * @param {string} params.event — hook event name
 * @param {string} [params.sessionId]
 * @param {string} [params.cwd]
 * @param {string} [params.toolName]
 * @param {Record<string, unknown>} [params.toolInput]
 * @param {string} [params.toolOutput]
 * @param {boolean} [params.isError]
 * @param {Record<string, unknown>} [params.metadata]
 * @returns {import("./hook-runner.mjs").HookInput}
 */
export function buildHookInput({ event, sessionId, cwd, toolName, toolInput, toolOutput, isError, metadata }) {
  return {
    hook_event_name: event,
    session_id: sessionId,
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
    is_error: isError,
    metadata,
  };
}
