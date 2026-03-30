/**
 * Agent session lifecycle — spawn, persist, capture, cleanup.
 *
 * Manages the full lifecycle of an implementer agent session:
 * prompt file creation → mux spawn → state persistence → output capture → cleanup.
 * No audit logic, no fixer retry logic.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkItem } from "../planning/types.js";
import { selectModelForTask, type ModelSelection } from "./model-routing.js";
import { buildImplementerPrompt } from "./implementer-prompt.js";
import type { RosterEntry } from "./implementer-prompt.js";
import type { WaveManifest } from "./dependency-context.js";
import { writePromptFile, writeScriptFile } from "../core/prompt-files.js";
import { FilesystemAgentStateStore } from "../state/filesystem/agent-state-store.js";
import type { AgentSessionState } from "../state/state-types.js";

// Re-export for backward compatibility
export type { AgentSessionState };

// ── Types ────────────────────────────────────

/** Options for spawning an agent session. */
export interface SpawnAgentOptions {
  repoRoot: string;
  item: WorkItem;
  trackName: string;
  provider: string;
  mux: import("../planning/types.js").MuxHandle;
  tmpDir: string;
  roster?: RosterEntry[];
  manifests?: WaveManifest[];
}

/** Handle returned from a successful agent spawn. */
export interface AgentHandle {
  sessionId: string;
  sessionName: string;
  outputFile: string;
  tier: ModelSelection;
}

// ── Agent State Persistence (delegates to FilesystemAgentStateStore) ──

const AGENTS_DIR = ".claude/agents";

/**
 * Persist agent state to `.claude/agents/{sessionId}.json` for daemon discovery.
 */
export function saveAgentState(
  repoRoot: string, sessionId: string, sessionName: string,
  backend: string, itemId: string, trackName: string, outputFile?: string,
): void {
  const store = new FilesystemAgentStateStore(resolve(repoRoot, AGENTS_DIR));
  store.save({
    id: sessionId, name: sessionName, backend,
    role: "implementer", type: "orchestrate",
    trackName, wbId: itemId,
    startedAt: Date.now(), status: "running",
    ...(outputFile ? { outputFile } : {}),
  });
}

/**
 * Remove persisted agent state file.
 */
export function removeAgentState(repoRoot: string, sessionId: string): void {
  const store = new FilesystemAgentStateStore(resolve(repoRoot, AGENTS_DIR));
  store.remove(sessionId);
}

// ── Agent Spawn ──────────────────────────────

/**
 * Spawn a single implementer agent into a mux session.
 *
 * 1. Selects model tier based on item size + domain detection
 * 2. Builds the implementer prompt
 * 3. Writes prompt file + platform-specific script
 * 4. Spawns mux session and sends the script command
 * 5. Persists agent state for daemon observability
 *
 * @returns AgentHandle on success, null on failure
 */
export async function spawnAgent(opts: SpawnAgentOptions): Promise<AgentHandle | null> {
  const { repoRoot, item, trackName, provider, mux, tmpDir, roster, manifests } = opts;
  const isWin = process.platform === "win32";

  try {
    const sessionName = `quorum-impl-${item.id}-${Date.now()}`;
    const promptFile = resolve(tmpDir, `${sessionName}.prompt.txt`);
    const outputFile = resolve(tmpDir, `${sessionName}.out`);

    const tier = selectModelForTask(provider, item.size, item.targetFiles);

    const prompt = buildImplementerPrompt(item, trackName, repoRoot, roster, manifests, tier.domains);
    writePromptFile(prompt, tmpDir, `${sessionName}.prompt.txt`);

    const modelFlag = tier.model ? ` --model ${tier.model}` : "";
    const cliFlags = tier.provider === "codex"
      ? "exec --json --full-auto -"
      : `-p --output-format stream-json --dangerously-skip-permissions${modelFlag}`;

    const scriptFile = writeScriptFile(tmpDir, sessionName, promptFile, outputFile, tier.provider, cliFlags);

    const session = await mux.spawn({
      name: sessionName,
      cwd: repoRoot,
      env: { FEEDBACK_LOOP_ACTIVE: "1" },
    });

    await new Promise(r => setTimeout(r, 1000));
    mux.send(session.id, isWin ? `& "${scriptFile}"` : `"${scriptFile}"`);

    saveAgentState(repoRoot, session.id, session.name, mux.getBackend(), item.id, trackName, outputFile);

    return { sessionId: session.id, sessionName: session.name, outputFile, tier };
  } catch (err) {
    console.error(`[agent-session] spawn failed for ${item.id}: ${(err as Error).message}`);
    return null;
  }
}

// ── Agent Output Capture ─────────────────────

/**
 * Read agent output from file (primary) or mux capture (fallback).
 * @returns Output text, or empty string if nothing available.
 */
export function captureAgentOutput(
  outputFile: string | undefined, mux: import("../planning/types.js").MuxHandle, sessionId: string,
): string {
  // Primary: read from output file (reliable)
  if (outputFile && existsSync(outputFile)) {
    try { return readFileSync(outputFile, "utf8"); } catch (err) { console.warn(`[agent-session] could not read output file ${outputFile}: ${(err as Error).message}`); }
  }
  // Fallback: capture-pane from mux
  const cap = mux.capture(sessionId, 200);
  return cap?.output ?? "";
}

/**
 * Check whether agent output indicates session completion.
 * Looks for final result markers (NOT intermediate stop_reason deltas).
 */
export function isAgentComplete(output: string): boolean {
  return output.includes('"type":"result","subtype":"success"')
    || output.includes('"type":"turn.completed"');
}
