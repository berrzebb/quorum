/**
 * Overview view — shows overall system status at a glance.
 *
 * Replaces the old "dashboard" view with structured panel composition.
 * Layout:
 *   Row 1: GateStatus + ItemStatePanel (if items exist)
 *   Row 2: AgentPanel + FitnessPanel + LockPanel (if locks) + SpecialistPanel (if specialists)
 *   Row 2.5: ParliamentPanel (if sessions) + AgentQueryPanel
 *   Row 3: FindingStatsPanel + OpenFindingsPanel + ReviewProgressPanel (if findings > 0)
 *   Row 4: TrackProgress + AuditStream
 */

import React from "react";
import { Box, Text } from "ink";
import type { FullState } from "../state-reader.js";
import type { QuorumEvent } from "../../platform/bus/events.js";
import { GateStatus } from "../components/GateStatus.js";
import { AgentPanel } from "../components/AgentPanel.js";
import { FitnessPanel } from "../components/FitnessPanel.js";
import { ParliamentPanel } from "../components/ParliamentPanel.js";
import { AgentQueryPanel } from "../components/AgentQueryPanel.js";
import { TrackProgress } from "../components/TrackProgress.js";
import { AuditStream } from "../components/AuditStream.js";
import { ItemStatePanel } from "../panels/overview/item-state-panel.js";
import { LockPanel } from "../panels/overview/lock-panel.js";
import { SpecialistPanel } from "../panels/overview/specialist-panel.js";
import { FindingStatsPanel } from "../panels/review/finding-stats-panel.js";
import { OpenFindingsPanel } from "../panels/review/open-findings-panel.js";
import { ReviewProgressPanel } from "../panels/review/review-progress-panel.js";

interface OverviewViewProps {
  state: FullState | null;
  events: QuorumEvent[];
  width: number;
  height: number;
}

export function OverviewView({ state, events, width: _width, height: _height }: OverviewViewProps): React.ReactElement {
  if (!state) {
    return <Box><Text dimColor>Loading overview...</Text></Box>;
  }

  return (
    <Box flexDirection="column" gap={1}>
      {/* Row 1: gate + item states */}
      <Box gap={2}>
        <GateStatus events={events} />
        {state.items.length > 0 && (
          <ItemStatePanel items={state.items} />
        )}
      </Box>

      {/* Row 2: agents + fitness + locks + specialists */}
      <Box gap={2}>
        <AgentPanel events={state.recentEvents} />
        <FitnessPanel fitness={state.fitness} />
        {state.locks.length > 0 && (
          <LockPanel locks={state.locks} />
        )}
        {state.specialists.length > 0 && (
          <SpecialistPanel specialists={state.specialists} />
        )}
      </Box>

      {/* Row 2.5: parliament + agent queries */}
      <Box gap={2}>
        {state.parliament.sessionCount > 0 && (
          <ParliamentPanel parliament={state.parliament} />
        )}
        <AgentQueryPanel queries={state.agentQueries} />
      </Box>

      {/* Row 3: finding stats + open findings + review progress */}
      {state.findingStats.total > 0 && (
        <Box gap={2}>
          <FindingStatsPanel stats={state.findingStats} />
          <OpenFindingsPanel findings={state.findings} />
          {state.reviewProgress.length > 0 && (
            <ReviewProgressPanel progress={state.reviewProgress} />
          )}
        </Box>
      )}

      {/* Row 4: tracks + audit stream */}
      <Box gap={2}>
        <TrackProgress tracks={state.tracks} />
        <AuditStream events={events} />
      </Box>
    </Box>
  );
}
