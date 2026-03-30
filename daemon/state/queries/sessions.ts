/**
 * Session queries — active specialists, agent queries.
 */

import type { EventStore } from "../../../platform/bus/store.js";
import type { EventType } from "../../../platform/bus/events.js";

// ── Types ────────────────────────────────────

export interface SpecialistInfo {
  domain: string;
  tool?: string;
  toolStatus?: string;
  agent?: string;
  agentVerdict?: string;
  timestamp: number;
}

export interface AgentQueryInfo {
  queryId: string;
  fromAgent: string;
  toAgent?: string;
  question: string;
  responseCount: number;
  timestamp: number;
}

// ── Queries ──────────────────────────────────

/**
 * Active specialist domain reviews from recent events.
 */
export function queryActiveSpecialists(store: EventStore): SpecialistInfo[] {
  try {
    const recentTool = store.query({
      eventType: "specialist.tool",
      limit: 20,
      descending: true,
    });
    const recentReview = store.query({
      eventType: "specialist.review",
      limit: 20,
      descending: true,
    });

    // Build a map of domain -> latest info
    const domainMap = new Map<string, SpecialistInfo>();

    for (const evt of recentTool) {
      const p = evt.payload;
      const domain = p.domain as string;
      domainMap.set(domain, {
        domain,
        tool: p.tool as string,
        toolStatus: p.status as string,
        timestamp: evt.timestamp,
      });
    }

    for (const evt of recentReview) {
      const p = evt.payload;
      const domain = p.domain as string;
      const existing = domainMap.get(domain);
      if (existing) {
        existing.agent = p.agent as string;
        existing.agentVerdict = p.verdict as string;
        existing.timestamp = Math.max(existing.timestamp, evt.timestamp);
      } else {
        domainMap.set(domain, {
          domain,
          agent: p.agent as string,
          agentVerdict: p.verdict as string,
          timestamp: evt.timestamp,
        });
      }
    }

    return [...domainMap.values()].sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    console.warn(`[sessions] queryActiveSpecialists failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Agent queries — recent inter-agent communication.
 */
export function queryAgentQueries(store: EventStore): AgentQueryInfo[] {
  try {
    const queryEvents = store.query({ eventType: "agent.query" as EventType, limit: 20, descending: true });
    const responseEvents = store.query({ eventType: "agent.response" as EventType, limit: 50, descending: true });

    // Count responses per queryId
    const responseCounts = new Map<string, number>();
    for (const e of responseEvents) {
      const qid = e.payload.queryId as string;
      if (qid) responseCounts.set(qid, (responseCounts.get(qid) ?? 0) + 1);
    }

    return queryEvents.map(e => ({
      queryId: (e.payload.queryId as string) ?? "",
      fromAgent: (e.payload.fromAgent as string) ?? "unknown",
      toAgent: (e.payload.toAgent as string) ?? undefined,
      question: (e.payload.question as string) ?? "",
      responseCount: responseCounts.get(e.payload.queryId as string) ?? 0,
      timestamp: e.timestamp,
    }));
  } catch (err) {
    console.warn(`[sessions] queryAgentQueries failed: ${(err as Error).message}`);
    return [];
  }
}
