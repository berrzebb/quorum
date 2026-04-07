/**
 * Mux session lifecycle — spawn, attach, capture-poll, cleanup.
 *
 * Wraps ProcessMux (bus/mux.ts) operations with agent state persistence
 * for daemon discovery and proper error handling.
 */

import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/** Options for spawning a mux session. */
export interface MuxSpawnOptions {
  /** ProcessMux instance (from detectMuxBackend). */
  mux: InstanceType<any>;
  /** Repo root for agent state persistence. */
  repoRoot: string;
  /** Provider CLI command name. */
  provider: string;
  /** CLI arguments for the provider. */
  args: string[];
  /** Logical role (e.g. "planner", "implementer"). */
  role: string;
  /** Track name for identification. */
  trackName: string;
}

/** Result from a successful mux spawn. */
export interface MuxSessionHandle {
  /** Session object from ProcessMux. */
  session: { id: string; name: string; pid?: number; backend: string; startedAt: number; status: string };
  /** Path to the persisted agent state file. */
  stateFile: string;
}

/**
 * Spawn a provider CLI process in a mux session.
 *
 * Persists agent state to `.claude/agents/` for daemon discovery.
 * Returns null if spawn fails (caller should fall back to direct mode).
 */
export async function spawnMuxSession(opts: MuxSpawnOptions): Promise<MuxSessionHandle | null> {
  const { mux, repoRoot, provider, args, role, trackName } = opts;
  const sessionName = `quorum-${role}-${Date.now()}`;

  let session;
  try {
    session = await mux.spawn({
      name: sessionName,
      command: provider,
      args,
      cwd: repoRoot,
      env: { FEEDBACK_LOOP_ACTIVE: "1" },
    });
  } catch (err) {
    console.warn(`[mux-session] spawn failed: ${(err as Error).message}`);
    return null;
  }

  if (session.status === "error") return null;

  // Persist agent state for daemon observability
  const agentState = {
    id: session.id,
    name: session.name,
    pid: session.pid,
    backend: session.backend,
    role,
    type: role,
    trackName,
    startedAt: session.startedAt,
    status: session.status,
  };
  const agentsDir = resolve(repoRoot, ".claude", "agents");
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
  const stateFile = resolve(agentsDir, `${session.id}.json`);
  writeFileSync(stateFile, JSON.stringify(agentState, null, 2), "utf8");

  return { session, stateFile };
}

/**
 * Poll mux capture output until completion markers appear or timeout.
 *
 * Completion markers: "type":"result", "stop_reason", "type":"turn.completed".
 */
export async function pollMuxCompletion(
  mux: InstanceType<any>,
  sessionId: string,
  _timeoutMs?: number,
  intervalMs = 5_000,
): Promise<void> {
  // No artificial timeout — agent runs until completion marker or session death.
  let nullCount = 0;
  while (true) {
    await new Promise(r => setTimeout(r, intervalMs));
    const cap = mux.capture(sessionId, 200);
    if (!cap || !cap.output) {
      // Session may have exited — allow a few retries then break
      nullCount++;
      if (nullCount >= 3) break; // 3 consecutive nulls = session gone
      continue;
    }
    nullCount = 0;
    if (
      cap.output.includes('"type":"result"') ||
      cap.output.includes('"stop_reason":"end_turn"') ||
      cap.output.includes('"stop_reason":"stop_sequence"') ||
      cap.output.includes('"type":"turn.completed"')
    ) break;
  }
}

/**
 * Clean up a mux session: remove agent state file, kill session, cleanup mux.
 */
export async function cleanupMuxSession(
  mux: InstanceType<any>,
  sessionId: string,
  stateFile: string,
): Promise<void> {
  try { rmSync(stateFile, { force: true }); } catch (err) { console.warn(`[mux-session] state file removal failed: ${(err as Error).message}`); }
  try { await mux.kill(sessionId); } catch (err) { console.warn(`[mux-session] session kill failed: ${(err as Error).message}`); }
  await mux.cleanup();
}
