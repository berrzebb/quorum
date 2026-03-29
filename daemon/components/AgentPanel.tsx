/**
 * Agent Panel — real-time view of active agents and their roles.
 *
 * Uses SQLite events (via fullState.recentEvents) instead of bus EventEmitter
 * so that external CLI events (orchestrate run, parliament, etc.) are visible.
 */

import React from "react";
import { Box, Text } from "ink";
import type { QuorumEvent } from "../../platform/bus/events.js";

interface AgentPanelProps {
  events: QuorumEvent[];
}

interface AgentState {
  id: string;
  role: string;
  status: "running" | "idle" | "auditing" | "correcting" | "done" | "error";
  source: string;
  lastUpdate: number;
}

export function AgentPanel({ events }: AgentPanelProps) {
  const agents = deriveAgents(events);

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
            <Text bold>{agent.id}</Text>
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

function elapsed(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function deriveAgents(events: QuorumEvent[]): AgentState[] {
  const agents = new Map<string, AgentState>();

  for (const event of events) {
    const id = (event.agentId ?? event.payload.agentId ?? event.payload.name) as string | undefined;
    if (!id) continue;

    switch (event.type) {
      case "agent.spawn":
        agents.set(id, {
          id,
          role: (event.payload.role as string) ?? "unknown",
          status: "running",
          source: event.source,
          lastUpdate: event.timestamp,
        });
        break;
      case "agent.progress": {
        const existing = agents.get(id);
        if (existing) {
          existing.status = "running";
          existing.lastUpdate = event.timestamp;
        }
        break;
      }
      case "agent.idle": {
        const existing = agents.get(id);
        if (existing) {
          existing.status = "idle";
          existing.lastUpdate = event.timestamp;
        }
        break;
      }
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
      case "audit.correction": {
        const existing = agents.get(id);
        if (existing) {
          existing.status = "correcting";
          existing.lastUpdate = event.timestamp;
        }
        break;
      }
    }
  }

  // Show active agents. Auto-expire stale "running" after 30 min (no complete event).
  const STALE_THRESHOLD = 30 * 60_000;
  return [...agents.values()]
    .filter((a) => {
      if (a.status === "done") return Date.now() - a.lastUpdate < 60_000;
      if (a.status === "running" && Date.now() - a.lastUpdate > STALE_THRESHOLD) return false;
      return true;
    })
    .sort((a, b) => b.lastUpdate - a.lastUpdate);
}
