/**
 * Mux lifecycle service — handles ProcessMux and agent session setup.
 * Extracted from daemon/index.ts to isolate mux concerns.
 *
 * Responsibilities:
 * - Mux session wrapper (re-launch inside tmux/psmux for remote attach)
 * - ProcessMux initialization for agent session management
 */

import { resolve } from "node:path";
import { ProcessMux, ensureMuxBackend } from "../../platform/bus/mux.js";
import type { MuxBackend } from "../../platform/bus/mux.js";

// ── Constants ────────────────────────────────────────────────────────

const DASHBOARD_SESSION = "quorum-dashboard";

// ── Types ────────────────────────────────────────────────────────────

export interface MuxWrapResult {
  /** True if the daemon was re-launched inside a mux session (caller should exit). */
  wrapped: boolean;
}

// ── Mux Session Wrapper ──────────────────────────────────────────────

/**
 * If a mux backend is available and we're NOT already inside a session,
 * create a mux session and re-launch the daemon inside it.
 * This enables remote attach/capture via `quorum status --attach`.
 *
 * Returns { wrapped: true } if the daemon was re-launched (caller should return).
 */
export async function tryWrapInMuxSession(repoRoot: string): Promise<MuxWrapResult> {
  if (process.env.QUORUM_IN_MUX_SESSION) {
    return { wrapped: false };
  }

  const backend = await ensureMuxBackend();
  if (backend === "raw") {
    return { wrapped: false };
  }

  const inSession = (backend === "tmux" && process.env.TMUX)
    || (backend === "psmux" && process.env.PSMUX_SESSION);

  if (inSession) {
    return { wrapped: false };
  }

  const mux = new ProcessMux(backend);
  try {
    const session = await mux.spawn({
      name: DASHBOARD_SESSION,
      command: process.execPath,
      args: [resolve(__dirname, "..", "index.js")],
      cwd: repoRoot,
      env: { QUORUM_IN_MUX_SESSION: "1" },
    });
    if (session.status === "error") throw new Error("session status: error");
    console.log(`Dashboard running in ${backend} session: ${DASHBOARD_SESSION}`);
    console.log(`Attach: ${backend === "tmux" ? "tmux attach -t" : "psmux attach -t"} ${DASHBOARD_SESSION}`);
    return { wrapped: true };
  } catch (err) {
    // Mux spawn failed — fall through to direct TUI rendering
    console.log(`Mux session creation failed — running TUI directly. ${process.env.QUORUM_DEBUG ? (err as Error).message : ""}`);
    return { wrapped: false };
  }
}

// ── ProcessMux for Agent Sessions ────────────────────────────────────

/**
 * Initialize ProcessMux for agent session management.
 * Returns null if mux is not available (chat view will be unavailable).
 */
export async function initializeMux(): Promise<ProcessMux | null> {
  try {
    const backend = await ensureMuxBackend();
    return new ProcessMux(backend);
  } catch {
    // Non-critical — chat view will be unavailable
    return null;
  }
}
