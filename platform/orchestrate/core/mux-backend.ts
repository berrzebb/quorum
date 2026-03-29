/**
 * Mux backend detection and instantiation.
 *
 * Wraps bus/mux.ts ProcessMux with fail-safe dynamic import.
 * Returns the instantiated ProcessMux and its backend type, or null
 * if mux is unavailable (missing dist, missing binary).
 */

import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** At runtime: dist/platform/orchestrate/core/ → up 2 → dist/platform/ */
const DIST_ROOT = resolve(__dirname, "..", "..");

export type MuxBackend = "tmux" | "psmux" | "raw";

export interface MuxBackendResult {
  /** The instantiated ProcessMux (from bus/mux.ts). */
  mux: InstanceType<any>;
  /** Detected backend type. */
  backend: MuxBackend;
}

/**
 * Dynamically load ProcessMux and detect the active backend.
 *
 * Returns null if ProcessMux cannot be loaded (dist not built, etc.).
 * Returns { mux, backend } otherwise — caller checks `backend === "raw"`
 * to decide whether mux mode is viable.
 */
export async function detectMuxBackend(): Promise<MuxBackendResult | null> {
  const toURL = (p: string) => pathToFileURL(p).href;

  let ProcessMux: any;
  try {
    const muxMod = await import(toURL(resolve(DIST_ROOT, "bus", "mux.js")));
    ProcessMux = muxMod.ProcessMux;
  } catch {
    return null;
  }

  const mux = new ProcessMux();
  const backend: MuxBackend = mux.getBackend();
  return { mux, backend };
}
