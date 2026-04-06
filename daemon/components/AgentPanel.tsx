/**
 * Agent Panel — real-time view of active agents and their roles.
 *
 * Sources: SQLite agent events + .claude/agents/*.json files.
 * Work content is shown in Chat View (AgentChatPanel), not here.
 */

import React from "react";
import { Box, Text } from "ink";
import type { QuorumEvent } from "../../platform/bus/events.js";
import { elapsed } from "../lib/time.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

interface AgentPanelProps {
  events: QuorumEvent[];
  repoRoot?: string;
}

interface AgentState {
  id: string;
  name: string;
  role: string;
  status: "running" | "idle" | "auditing" | "correcting" | "done" | "error";
  source: string;
  lastUpdate: number;
  wbId?: string;
}

export function AgentPanel({ events, repoRoot }: AgentPanelProps) {
  const agents = deriveAgents(events, repoRoot);

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} flexGrow={1}>
      <Text bold>Agents</Text>
      <Text dimColor>{"─".repeat(40)}</Text>

      {agents.length === 0 ? (
        <Text dimColor>No active agents</Text>
      ) : (
        agents.map((agent) => (
          <Box key={agent.id} gap={1}>
            <Text>{statusIcon(agent.status)}</Text>
            <Text bold>{agent.name || agent.id}</Text>
            <Text dimColor>({agent.role})</Text>
            <Text color="blue">[{agent.source}]</Text>
            <Text dimColor>{elapsed(agent.lastUpdate)}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}

function statusIcon(status: AgentState["status"]): string {
  switch (status) {
    case "running": return "🟢";
    case "idle": return "⚪";
    case "auditing": return "🟡";
    case "correcting": return "🔵";
    case "done": return "✅";
    case "error": return "🔴";
  }
}

/**
 * Derive agent list from events + .claude/agents/*.json files.
 */
function deriveAgents(events: QuorumEvent[], repoRoot?: string): AgentState[] {
  const agents = new Map<string, AgentState>();

  // Source 1: SQLite events
  for (const event of events) {
    const id = (event.agentId ?? event.payload.agentId ?? event.payload.name) as string | undefined;
    if (!id) continue;

    switch (event.type) {
      case "agent.spawn":
        agents.set(id, {
          id,
          name: (event.payload.name as string) ?? id,
          role: (event.payload.role as string) ?? "unknown",
          status: "running",
          source: event.source,
          lastUpdate: event.timestamp,
          wbId: (event.payload.wbId as string) ?? undefined,
        });
        break;
      case "agent.complete": {
        const existing = agents.get(id);
        if (existing) {
          existing.status = "done";
          existing.lastUpdate = event.timestamp;
        }
        break;
      }
      case "agent.error": {
        const existing = agents.get(id);
        if (existing) {
          existing.status = "error";
          existing.lastUpdate = event.timestamp;
        }
        break;
      }
      case "audit.start": {
        const existing = agents.get(id);
        if (existing) {
          existing.status = "auditing";
          existing.lastUpdate = event.timestamp;
        }
        break;
      }
    }
  }

  // Source 2: .claude/agents/*.json files (live process/mux state)
  if (repoRoot) {
    const agentsDir = resolve(repoRoot, ".claude", "agents");
    if (existsSync(agentsDir)) {
      try {
        const files = readdirSync(agentsDir).filter(f => f.endsWith(".json"));
        for (const f of files) {
          try {
            const agent = JSON.parse(readFileSync(resolve(agentsDir, f), "utf8"));
            const id = agent.name ?? f.replace(".json", "");
            const eventId = `impl-${agent.wbId}`;

            // Merge with event-derived state or create new
            const existing = agents.get(id) ?? agents.get(eventId);
            if (existing) {
              existing.name = agent.name ?? existing.name;
            } else {
              agents.set(id, {
                id,
                name: agent.name ?? id,
                role: agent.role ?? "implementer",
                status: "running",
                source: agent.backend ?? "unknown",
                lastUpdate: agent.startedAt ?? Date.now(),
                wbId: agent.wbId,
              });
            }
          } catch { /* skip malformed */ }
        }
      } catch { /* no agents dir */ }
    }
  }

  // Filter: show active agents. Auto-expire stale "running" after 30 min.
  const STALE_THRESHOLD = 30 * 60_000;
  return [...agents.values()]
    .filter((a) => {
      if (a.status === "done") return Date.now() - a.lastUpdate < 60_000;
      if (a.status === "running" && Date.now() - a.lastUpdate > STALE_THRESHOLD) return false;
      return true;
    })
    .sort((a, b) => b.lastUpdate - a.lastUpdate);
}
