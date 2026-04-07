/**
 * Gate Status — the heart of quorum's structural enforcement, visualized.
 *
 * Shows the current state of each enforcement gate:
 * - Audit gate: evidence submitted → waiting for verdict → approved/rejected
 * - Session gate: retro pending → Bash/Agent blocked → retro complete
 * - Quality gate: lint/test pass/fail per file
 *
 * The point is to make "why am I blocked?" immediately visible.
 */

import React from "react";
import { Box, Text } from "ink";
import type { QuorumEvent } from "../../platform/bus/events.js";

interface GateStatusProps {
  events: QuorumEvent[];
}

type GateState = "open" | "blocked" | "pending" | "error";

interface Gate {
  name: string;
  state: GateState;
  reason?: string;
}

export function GateStatus({ events }: GateStatusProps) {
  const gates = deriveGates(events);
  const profile = deriveProfile(events);

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={30}>
      <Box gap={1}>
        <Text bold>Enforcement Gates</Text>
        <Text dimColor>[{profile}]</Text>
      </Box>
      <Text dimColor>{"─".repeat(26)}</Text>

      {gates.map((gate) => (
        <Box key={gate.name} gap={1}>
          <Text>{stateIcon(gate.state)}</Text>
          <Box flexDirection="column">
            <Text bold={gate.state === "blocked"}>{gate.name}</Text>
            {gate.reason && (
              <Text dimColor wrap="truncate">  {gate.reason}</Text>
            )}
          </Box>
        </Box>
      ))}

      <Text dimColor>{"─".repeat(26)}</Text>
      <Box gap={1}>
        <Text>Flow:</Text>
        {flowArrow(gates)}
      </Box>
      <Text dimColor>s: steer</Text>
    </Box>
  );
}

function stateIcon(state: GateState): string {
  switch (state) {
    case "open": return "🟢";
    case "blocked": return "🔴";
    case "pending": return "🟡";
    case "error": return "⚠️";
  }
}

function deriveGates(events: QuorumEvent[]): Gate[] {
  // Find latest relevant events
  const lastAuditSubmit = findLast(events, "audit.submit");
  const lastAuditVerdict = findLast(events, "audit.verdict");
  const lastRetroStart = findLast(events, "retro.start");
  const lastRetroComplete = findLast(events, "retro.complete");
  // Audit gate
  let auditGate: Gate;
  if (!lastAuditSubmit) {
    auditGate = { name: "Audit", state: "open", reason: "No submission" };
  } else if (!lastAuditVerdict || lastAuditVerdict.timestamp < lastAuditSubmit.timestamp) {
    auditGate = { name: "Audit", state: "pending", reason: "Awaiting verdict..." };
  } else {
    const verdict = lastAuditVerdict.payload.verdict as string;
    auditGate = verdict === "approved"
      ? { name: "Audit", state: "open", reason: "Approved" }
      : { name: "Audit", state: "blocked", reason: `Rejected: ${(lastAuditVerdict.payload.codes as string[])?.join(", ") ?? ""}` };
  }

  // Session gate (retro)
  let retroGate: Gate;
  if (!lastRetroStart) {
    retroGate = { name: "Retro", state: "open", reason: "Not required" };
  } else if (!lastRetroComplete || lastRetroComplete.timestamp < lastRetroStart.timestamp) {
    retroGate = { name: "Retro", state: "blocked", reason: "Bash/Agent blocked" };
  } else {
    retroGate = { name: "Retro", state: "open", reason: "Complete" };
  }

  // Quality gate
  let qualityGate: Gate;
  const recentFails = events.filter(
    (e) => e.type === "quality.fail" && e.timestamp > Date.now() - 300_000,
  );
  if (recentFails.length > 0) {
    qualityGate = { name: "Quality", state: "blocked", reason: `${recentFails.length} failures` };
  } else {
    qualityGate = { name: "Quality", state: "open", reason: "All clear" };
  }

  return [auditGate, retroGate, qualityGate];
}

function flowArrow(gates: Gate[]): React.ReactNode {
  return (
    <Text>
      {gates.map((g, i) => {
        const color = g.state === "open" ? "green" : g.state === "blocked" ? "red" : "yellow";
        const icon = g.state === "open" ? "→" : "✕";
        return (
          <React.Fragment key={g.name}>
            {i > 0 && <Text color={color}> {icon} </Text>}
            <Text color={color}>{g.name[0]}</Text>
          </React.Fragment>
        );
      })}
    </Text>
  );
}

function deriveProfile(events: QuorumEvent[]): string {
  const lastSteer = findLast(events, "steering.switch");
  if (lastSteer) return (lastSteer.payload.to as string) ?? "balanced";
  return "balanced";
}

function findLast(events: QuorumEvent[], type: string): QuorumEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === type) return events[i];
  }
  return undefined;
}
