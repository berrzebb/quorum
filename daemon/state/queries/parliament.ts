/**
 * Parliament queries — committee convergence, verdict, amendments, conformance, live sessions.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { openSync, readSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import type { EventStore } from "../../../platform/bus/store.js";
import type { EventType } from "../../../platform/bus/events.js";
import { COMMITTEE_IDS } from "../../../platform/bus/meeting-log.js";
import { getPendingAmendmentCount } from "../../../platform/bus/amendment.js";

// ── Types ────────────────────────────────────

export interface ParliamentCommitteeStatus {
  committee: string;
  converged: boolean;
  stableRounds: number;
  noNewItemsRounds: number;
  relaxedRounds: number;
  threshold: number;
  score: number;
  convergencePath: "exact" | "no-new-items" | "relaxed" | null;
}

export interface ParliamentLiveSession {
  id: string;
  name: string;
  role: string;
  backend: string;
  startedAt: number;
  outputFile?: string;
  /** Output file size in bytes (real-time progress indicator). */
  outputSize?: number;
  /** Last snippet of assistant text from the output (truncated). */
  outputPreview?: string;
}

export interface ParliamentInfo {
  /** Per-committee convergence status. */
  committees: ParliamentCommitteeStatus[];
  /** Latest session verdict. */
  lastVerdict: string | null;
  /** Number of pending (unresolved) amendments. */
  pendingAmendments: number;
  /** Normal Form conformance (0-1). */
  conformance: number | null;
  /** Total parliament sessions recorded. */
  sessionCount: number;
  /** Active mux sessions (from .claude/agents/) */
  liveSessions: ParliamentLiveSession[];
}

// ── Query ────────────────────────────────────

/**
 * Parliament state: committee convergence, last verdict, pending amendments, conformance.
 */
export function queryParliamentInfo(store: EventStore, liveSessionsCache: { ts: number; data: ParliamentLiveSession[] }): ParliamentInfo {
  const defaultCommittee = (c: string): ParliamentCommitteeStatus => ({ committee: c, converged: false, stableRounds: 0, noNewItemsRounds: 0, relaxedRounds: 0, threshold: 2, score: 0, convergencePath: null });
  const empty: ParliamentInfo = {
    committees: COMMITTEE_IDS.map(defaultCommittee),
    lastVerdict: null, pendingAmendments: 0, conformance: null, sessionCount: 0,
    liveSessions: [],
  };

  try {
    // Session count + last verdict
    const sessions = store.query({ eventType: "parliament.session.digest" as EventType, limit: 100, descending: true });
    empty.sessionCount = sessions.length;

    if (sessions.length > 0) {
      const last = sessions[0]!;
      empty.lastVerdict = (last.payload.verdictResult as string) ?? null;
    }

    // Convergence per committee
    const convergenceEvents = store.query({ eventType: "parliament.convergence" as EventType, limit: 50, descending: true });
    const latestByCommittee = new Map<string, typeof convergenceEvents[0]>();
    for (const e of convergenceEvents) {
      const agenda = (e.payload.agendaId as string) ?? "";
      if (!latestByCommittee.has(agenda)) latestByCommittee.set(agenda, e); // DESC order -> first seen = latest
    }
    empty.committees = COMMITTEE_IDS.map(c => {
      const e = latestByCommittee.get(c);
      if (!e) return defaultCommittee(c);
      return {
        committee: c,
        converged: (e.payload.converged as boolean) ?? false,
        stableRounds: (e.payload.stableRounds as number) ?? 0,
        noNewItemsRounds: (e.payload.noNewItemsRounds as number) ?? 0,
        relaxedRounds: (e.payload.relaxedRounds as number) ?? 0,
        threshold: (e.payload.threshold as number) ?? 2,
        score: (e.payload.convergenceScore as number) ?? 0,
        convergencePath: (e.payload.convergencePath as "exact" | "no-new-items" | "relaxed" | null) ?? null,
      };
    });

    // Pending amendments
    empty.pendingAmendments = getPendingAmendmentCount(store);

    // Conformance -- read from normalform events (digest doesn't carry conformance)
    const nfEvents = store.query({ eventType: "parliament.session.normalform" as EventType, limit: 1, descending: true });
    if (nfEvents.length > 0) {
      const lastNf = nfEvents[0]!;
      const allConverged = lastNf.payload.allConverged as boolean | undefined;
      empty.conformance = allConverged === true ? 1.0 : allConverged === false ? 0.0 : null;
    }

    // Live sessions (cached, 5s TTL -- filesystem I/O)
    empty.liveSessions = readLiveParliamentSessions(liveSessionsCache, store);

    return empty;
  } catch (err) {
    console.warn(`[parliament] queryParliamentInfo failed: ${(err as Error).message}`);
    return empty;
  }
}

/**
 * Read active parliament mux sessions from .claude/agents/ directory.
 * Cached with 5-second TTL to avoid sync filesystem I/O on every 1s poll.
 */
export function readLiveParliamentSessions(cache: { ts: number; data: ParliamentLiveSession[] }, store?: EventStore): ParliamentLiveSession[] {
  const now = Date.now();
  if (now - cache.ts < 5000) return cache.data;

  try {
    // Derive repo root from store db path (.claude/quorum/state.db → up 3 → repo root)
    // Falls back to process.cwd() if db path is unavailable
    let repoRoot = process.cwd();
    try {
      const dbName: string = store?.getDb?.()?.name ?? "";
      if (dbName && !dbName.startsWith(":")) {
        repoRoot = resolve(dbName, "..", "..", "..");
      }
    } catch (err) { console.warn(`[parliament] db path resolution failed, using cwd: ${(err as Error).message}`); }
    const agentsDir = resolve(repoRoot, ".claude", "agents");
    if (!existsSync(agentsDir)) {
      cache.ts = now;
      cache.data = [];
      return [];
    }

    const files = readdirSync(agentsDir).filter(f => f.endsWith(".json"));
    const sessions: ParliamentLiveSession[] = [];

    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(resolve(agentsDir, f), "utf8"));
        if ((data.type === "parliament" || data.type === "planner" || data.type === "orchestrate") && data.status === "running") {
          const session: ParliamentLiveSession = {
            id: data.id,
            name: data.name ?? data.id,
            role: data.role ?? "unknown",
            backend: data.backend ?? "raw",
            startedAt: data.startedAt ?? 0,
            ...(data.outputFile ? { outputFile: data.outputFile } : {}),
          };

          // Read output file for live progress
          if (data.outputFile && existsSync(data.outputFile)) {
            try {
              const st = statSync(data.outputFile);
              session.outputSize = st.size;
              session.outputPreview = extractOutputPreview(data.outputFile, st.size);
            } catch { /* file may be locked */ }
          }

          sessions.push(session);
        }
      } catch (err) { console.warn(`[parliament] corrupt agent file ${f}: ${(err as Error).message}`); }
    }

    cache.ts = now;
    cache.data = sessions;
    return sessions;
  } catch (err) {
    console.warn(`[parliament] readLiveParliamentSessions failed: ${(err as Error).message}`);
    cache.ts = now;
    cache.data = [];
    return [];
  }
}

/**
 * Extract a short text preview from an NDJSON output file.
 * Reads the last 4KB to find the most recent assistant text.
 *
 * Wire formats:
 *   Claude: "text":"..." in content_block_delta events
 *   Codex:  "text":"..." in item.completed agent_message events
 */
function extractOutputPreview(filePath: string, fileSize: number): string | undefined {
  if (fileSize === 0) return undefined;

  // Read last 4KB (enough for recent events, avoids reading entire file)
  const chunkSize = Math.min(4096, fileSize);
  const buf = Buffer.alloc(chunkSize);
  let fd: number;
  try {
    fd = openSync(filePath, "r");
    readSync(fd, buf, 0, chunkSize, Math.max(0, fileSize - chunkSize));
    closeSync(fd);
  } catch { return undefined; }

  const tail = buf.toString("utf8");

  // Find all "text":"..." values — last one is most recent
  const textMatches = tail.match(/"text"\s*:\s*"([^"]{1,500})"/g);
  if (!textMatches || textMatches.length === 0) return undefined;

  // Extract the value from the last match
  const last = textMatches[textMatches.length - 1]!;
  const valMatch = last.match(/"text"\s*:\s*"(.+)"/);
  if (!valMatch) return undefined;

  // Unescape JSON string escapes and truncate
  let text = valMatch[1]!;
  try { text = JSON.parse(`"${text}"`); } catch { /* use raw */ }

  // Trim to ~60 chars for panel display
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}
