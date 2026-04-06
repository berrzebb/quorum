/**
 * Audit Stream — chronological event log with enforcement context.
 *
 * Each event shows: timestamp, source provider, event type, and payload summary.
 * Gate-related events (audit.verdict, retro.*, quality.*) are highlighted.
 */

import React from "react";
import { Box, Text } from "ink";
import type { QuorumEvent, EventType } from "../../platform/bus/events.js";

interface AuditStreamProps {
  events: QuorumEvent[];
  fullScreen?: boolean;
}

const MAX_LINES = 15;
const MAX_LINES_FULL = 40;

export function AuditStream({ events, fullScreen }: AuditStreamProps) {
  const limit = fullScreen ? MAX_LINES_FULL : MAX_LINES;
  const visible = events.slice(-limit);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      paddingX={1}
      flexGrow={fullScreen ? 1 : undefined}
    >
      <Text bold>Event Stream</Text>
      <Text dimColor>{"─".repeat(50)}</Text>

      {visible.length === 0 ? (
        <Text dimColor>Waiting for events...</Text>
      ) : (
        visible.map((event, i) => (
          <Text key={`${event.timestamp}-${i}`} wrap="truncate">
            <Text dimColor>{formatTime(event.timestamp)}</Text>
            {" "}
            <Text color={sourceColor(event.source)}>{event.source.slice(0, 7).padEnd(7)}</Text>
            {" "}
            <Text color={eventColor(event.type)} bold={isGateEvent(event.type)}>
              {event.type.padEnd(20)}
            </Text>
            {" "}
            <Text>{summarize(event)}</Text>
          </Text>
        ))
      )}
    </Box>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function sourceColor(source: string): string {
  switch (source) {
    case "claude-code": return "cyan";
    case "codex": return "green";
    case "cursor": return "magenta";
    case "gemini": return "yellow";
    case "ollama": return "blue";
    case "vllm": return "blueBright";
    case "openai": return "greenBright";
    default: return "white";
  }
}

function eventColor(type: EventType): string {
  if (type.startsWith("audit.")) return "yellow";
  if (type.startsWith("retro.")) return "magenta";
  if (type.startsWith("quality.")) return "red";
  if (type.startsWith("agent.")) return "cyan";
  if (type.startsWith("track.")) return "green";
  if (type.startsWith("merge.")) return "blue";
  return "white";
}

function isGateEvent(type: EventType): boolean {
  return [
    "audit.verdict",
    "retro.start",
    "retro.complete",
    "quality.fail",
    "quality.pass",
    "merge.complete",
  ].includes(type);
}

function summarize(event: QuorumEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "audit.verdict":
      return `${p.verdict} ${(p.codes as string[])?.join(",") ?? ""}`;
    case "audit.submit": {
      const files = p.changedFiles as string[] | undefined;
      const fileHint = files?.length ? files.slice(0, 2).map(f => (f as string).split("/").pop()).join(", ") : "";
      return `evidence → ${p.tier ?? ""}${p.mode ? ` (${p.mode})` : ""}${fileHint ? ` ${fileHint}` : ""}`;
    }
    case "agent.spawn":
      return `${p.name ?? p.agentId ?? p.wbId ?? "agent"} (${p.role ?? "impl"})`;
    case "agent.complete":
      return `${p.name ?? event.agentId} finished`;
    case "quality.fail":
      return `${p.label}: ${p.file}`;
    case "quality.pass":
      return `${p.label}: ${p.file}`;
    case "track.progress":
      return `${p.completed}/${p.total} (${p.blocked ?? 0} blocked)`;
    case "retro.start":
      return "Bash/Agent BLOCKED";
    case "retro.complete":
      return "gate released";
    case "merge.complete":
      return `squash → ${p.commit ?? ""}`;
    default:
      return Object.values(p).filter(Boolean).join(" ").slice(0, 40);
  }
}
