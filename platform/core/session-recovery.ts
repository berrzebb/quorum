/**
 * Session Recovery — detect and recover from session crashes.
 *
 * Analyzes message history to detect interrupted sessions and
 * builds continuation messages for seamless recovery.
 *
 * @module core/session-recovery
 */

// ── Types ───────────────────────────────────────────

/** Crash state classification. */
export type SessionCrashKind = "none" | "interrupted_turn" | "interrupted_prompt";

/** Result of crash detection. */
export interface SessionCrashState {
  kind: SessionCrashKind;
  /** Index of the last complete message. */
  lastCompleteIndex: number;
  /** Partial content from the interrupted message (if any). */
  partialContent?: string;
}

/** A message in the session history. */
export interface SessionMessage {
  role: "user" | "assistant" | "tool_result" | "system";
  content?: string;
  /** Whether this message represents a completed turn. */
  complete?: boolean;
  /** Timestamp of the message. */
  timestamp?: number;
}

/** Wave state snapshot (from wave-state-{track}.json). */
export interface WaveStateSnapshot {
  completedIds: string[];
  failedIds: string[];
  lastCompletedWave: number;
  totalItems: number;
  totalWaves: number;
  lastFitness?: number;
}

// ── Crash Detection ─────────────────────────────────

/**
 * Detect whether a session was interrupted.
 *
 * Decision tree:
 * - No messages → none
 * - Last message = assistant without completion marker → interrupted_turn
 * - Last message = user (no assistant response) → interrupted_prompt
 * - Last message = tool_result (tool was running) → interrupted_turn
 * - Otherwise → none (normal termination)
 */
export function detectSessionCrash(
  messages: SessionMessage[],
  lastTimestamp?: number,
): SessionCrashState {
  if (messages.length === 0) {
    return { kind: "none", lastCompleteIndex: -1 };
  }

  const last = messages[messages.length - 1]!;
  const lastIdx = messages.length - 1;

  // Last message is from assistant
  if (last.role === "assistant") {
    // Check for completion markers
    if (last.complete === true) {
      return { kind: "none", lastCompleteIndex: lastIdx };
    }
    // No completion marker → interrupted mid-response
    return {
      kind: "interrupted_turn",
      lastCompleteIndex: lastIdx - 1,
      partialContent: last.content,
    };
  }

  // Last message is from user (no assistant response)
  if (last.role === "user") {
    return {
      kind: "interrupted_prompt",
      lastCompleteIndex: lastIdx - 1,
    };
  }

  // Last message is a tool result (tool was running when crash happened)
  if (last.role === "tool_result") {
    return {
      kind: "interrupted_turn",
      lastCompleteIndex: lastIdx - 1,
      partialContent: last.content,
    };
  }

  // System or unknown — treat as normal
  return { kind: "none", lastCompleteIndex: lastIdx };
}

// ── Continuation Builder ────────────────────────────

/**
 * Build a synthetic continuation message based on crash state.
 *
 * The continuation provides context about what was happening
 * when the session was interrupted, so the agent can resume.
 */
export function buildContinuation(
  state: SessionCrashState,
  messages: SessionMessage[],
  waveState?: WaveStateSnapshot,
): string {
  if (state.kind === "none") return "";

  const parts: string[] = [];

  parts.push("[SESSION RECOVERY] The previous session was interrupted.");

  // Describe what was happening
  if (state.kind === "interrupted_turn") {
    parts.push("The assistant was in the middle of a response when the process terminated.");
    if (state.partialContent) {
      const truncated = state.partialContent.length > 200
        ? state.partialContent.slice(0, 200) + "..."
        : state.partialContent;
      parts.push(`Partial response: "${truncated}"`);
    }
  } else if (state.kind === "interrupted_prompt") {
    // Find the last user message
    const lastUser = messages.filter(m => m.role === "user").pop();
    if (lastUser?.content) {
      const truncated = lastUser.content.length > 200
        ? lastUser.content.slice(0, 200) + "..."
        : lastUser.content;
      parts.push(`The user's last message was: "${truncated}"`);
    }
    parts.push("No response was generated before the interruption.");
  }

  // Wave state context
  if (waveState) {
    parts.push("");
    parts.push("Wave execution state:");
    parts.push(`- Completed: ${waveState.completedIds.length}/${waveState.totalItems} items`);
    parts.push(`- Failed: ${waveState.failedIds.length} items`);
    parts.push(`- Last completed wave: ${waveState.lastCompletedWave}/${waveState.totalWaves}`);
    if (waveState.lastFitness !== undefined) {
      parts.push(`- Last fitness score: ${waveState.lastFitness.toFixed(2)}`);
    }
    if (waveState.failedIds.length > 0) {
      parts.push(`- Failed item IDs: ${waveState.failedIds.join(", ")}`);
    }
    parts.push("");
    parts.push("Resume from where the interruption occurred.");
  }

  return parts.join("\n");
}
