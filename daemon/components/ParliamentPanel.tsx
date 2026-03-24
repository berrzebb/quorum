/**
 * ParliamentPanel — parliament protocol status for the TUI dashboard.
 *
 * Shows:
 * - Per-committee convergence status (6 standing committees)
 * - Latest session verdict
 * - Pending amendments count
 * - Normal Form conformance bar
 */

import React from "react";
import { Box, Text } from "ink";
import type { ParliamentInfo } from "../state-reader.js";
import { STANDING_COMMITTEES, type StandingCommittee } from "../../bus/meeting-log.js";

interface ParliamentPanelProps {
  parliament: ParliamentInfo;
}

export function ParliamentPanel({ parliament }: ParliamentPanelProps) {
  const { committees, lastVerdict, pendingAmendments, conformance, sessionCount, liveSessions } = parliament;
  const hasData = sessionCount > 0 || committees.some(c => c.stableRounds > 0) || (liveSessions?.length ?? 0) > 0;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={42}>
      <Text bold>Parliament</Text>
      <Text dimColor>{"─".repeat(38)}</Text>

      {!hasData ? (
        <Text dimColor>No parliament sessions yet</Text>
      ) : (
        <>
          {/* Live mux sessions */}
          {liveSessions && liveSessions.length > 0 && (
            <Box flexDirection="column">
              <Text color="cyan" bold>LIVE ({liveSessions.length})</Text>
              {liveSessions.map((s) => {
                const age = Math.round((Date.now() - s.startedAt) / 1000);
                const roleColor = s.role === "advocate" ? "green" : s.role === "devil" ? "red" : "blue";
                return (
                  <Text key={s.id}>
                    <Text color={roleColor}>{padRight(s.role, 10)}</Text>
                    <Text dimColor>{s.backend} {age}s</Text>
                  </Text>
                );
              })}
            </Box>
          )}

          {/* Session count + amendments */}
          <Box gap={1}>
            <Text>Sessions: <Text bold>{sessionCount}</Text></Text>
            {pendingAmendments > 0 && (
              <Text color="yellow"> Amend: {pendingAmendments}</Text>
            )}
          </Box>

          {/* Conformance bar */}
          {conformance !== null && (
            <Box gap={1}>
              <Text>Normal Form: </Text>
              <Text color={conformance >= 0.8 ? "green" : conformance >= 0.5 ? "yellow" : "red"}>
                {bar(conformance, 12)}
              </Text>
              <Text dimColor> {(conformance * 100).toFixed(0)}%</Text>
            </Box>
          )}

          {/* Committee convergence */}
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Committees</Text>
            {committees.map((c) => (
              <Box key={c.committee}>
                <Text>{padRight(shortName(c.committee), 14)}</Text>
                <Text color={c.converged ? "green" : c.stableRounds > 0 ? "yellow" : "gray"}>
                  {c.converged ? "✓" : "○"}
                </Text>
                <Text dimColor> {c.stableRounds}/{c.threshold}</Text>
                {c.score > 0 && (
                  <Text dimColor> ({c.score.toFixed(2)})</Text>
                )}
              </Box>
            ))}
          </Box>

          {/* Latest verdict */}
          {lastVerdict && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Last Verdict</Text>
              <Text>{lastVerdict.length > 36 ? lastVerdict.slice(0, 36) + "..." : lastVerdict}</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

// ── Helpers ──────────────────────────────────

function bar(value: number, width: number): string {
  const filled = Math.round(value * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function shortName(committee: string): string {
  const entry = STANDING_COMMITTEES[committee as StandingCommittee];
  if (!entry) return committee;
  const name = entry.name;
  return name.length > 12 ? name.slice(0, 11) + "…" : name;
}
