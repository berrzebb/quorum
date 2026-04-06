/**
 * Operations view — runtime monitoring.
 *
 * Layout:
 *   Row 1: AgentPanel + FitnessPanel
 *   Row 2: LockPanel + SpecialistPanel (if any)
 *   Row 3: AgentQueryPanel (if queries)
 */

import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";
import { FocusBox } from "../components/FocusBox.js";
import { AgentPanel } from "../components/AgentPanel.js";
import { FitnessPanel } from "../components/FitnessPanel.js";
import { AgentQueryPanel } from "../components/AgentQueryPanel.js";
import { LockPanel } from "../panels/overview/lock-panel.js";
import { SpecialistPanel } from "../panels/overview/specialist-panel.js";

interface OperationsViewProps {
  state: FullState | null;
  focusedRegion?: string | null;
  width: number;
  height: number;
}

export const OperationsView = React.memo(function OperationsView({ state, focusedRegion, width: _width, height: _height }: OperationsViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading operations...</Text></Box>;
  }

  const f = (region: string) => focusedRegion === region;

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <FocusBox focused={f("operations.providers")}>
          <AgentPanel events={state.agentEvents} />
        </FocusBox>
        <FocusBox focused={f("operations.worktrees")}>
          <FitnessPanel fitness={state.fitness} />
        </FocusBox>
      </Box>

      {(state.locks.length > 0 || state.specialists.length > 0) && (
        <Box gap={2}>
          {state.locks.length > 0 && <LockPanel locks={state.locks} />}
          {state.specialists.length > 0 && <SpecialistPanel specialists={state.specialists} />}
        </Box>
      )}

      {state.agentQueries.length > 0 && (
        <AgentQueryPanel queries={state.agentQueries} />
      )}
    </Box>
  );
});
