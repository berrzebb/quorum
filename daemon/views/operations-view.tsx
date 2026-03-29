/**
 * Operations view — provider, lock, worktree, diagnostics.
 *
 * Layout:
 *   Row 1: AgentPanel + FitnessPanel
 *   Row 2: LockPanel (if locks) + SpecialistPanel (if specialists)
 *   Row 3: AgentQueryPanel (if queries)
 */

import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";
import { AgentPanel } from "../components/AgentPanel.js";
import { FitnessPanel } from "../components/FitnessPanel.js";
import { AgentQueryPanel } from "../components/AgentQueryPanel.js";
import { LockPanel } from "../panels/overview/lock-panel.js";
import { SpecialistPanel } from "../panels/overview/specialist-panel.js";

interface OperationsViewProps {
  state: FullState | null;
  width: number;
  height: number;
}

export function OperationsView({ state, width: _width, height: _height }: OperationsViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading operations...</Text></Box>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {/* Row 1: agents + fitness */}
      <Box gap={2}>
        <AgentPanel events={state.recentEvents} />
        <FitnessPanel fitness={state.fitness} />
      </Box>

      {/* Row 2: locks + specialists */}
      {(state.locks.length > 0 || state.specialists.length > 0) && (
        <Box gap={2}>
          {state.locks.length > 0 && (
            <LockPanel locks={state.locks} />
          )}
          {state.specialists.length > 0 && (
            <SpecialistPanel specialists={state.specialists} />
          )}
        </Box>
      )}

      {/* Row 3: agent queries */}
      {state.agentQueries.length > 0 && (
        <AgentQueryPanel queries={state.agentQueries} />
      )}
    </Box>
  );
}
