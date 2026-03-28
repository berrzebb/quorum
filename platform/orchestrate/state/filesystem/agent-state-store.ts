/**
 * Filesystem-backed agent session store.
 *
 * Implements AgentStatePort — reads/writes `.claude/agents/{sessionId}.json`.
 * Mirrors the exact I/O from runner.ts saveAgentState/removeAgentState.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentStatePort } from "../state-port.js";
import type { AgentSessionState } from "../state-types.js";

export class FilesystemAgentStateStore implements AgentStatePort {
  constructor(private baseDir: string) {}

  load(agentId: string): AgentSessionState | null {
    const p = resolve(this.baseDir, `${agentId}.json`);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as AgentSessionState;
    } catch {
      return null;
    }
  }

  save(state: AgentSessionState): void {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
    writeFileSync(
      resolve(this.baseDir, `${state.id}.json`),
      JSON.stringify(state, null, 2),
      "utf8",
    );
  }

  remove(agentId: string): void {
    try {
      rmSync(resolve(this.baseDir, `${agentId}.json`), { force: true });
    } catch {
      /* fail-open */
    }
  }

  list(): AgentSessionState[] {
    if (!existsSync(this.baseDir)) return [];
    try {
      const files = readdirSync(this.baseDir).filter(f => f.endsWith(".json"));
      const results: AgentSessionState[] = [];
      for (const f of files) {
        try {
          const data = JSON.parse(
            readFileSync(resolve(this.baseDir, f), "utf8"),
          ) as AgentSessionState;
          results.push(data);
        } catch {
          /* skip corrupt files */
        }
      }
      return results;
    } catch {
      return [];
    }
  }
}
