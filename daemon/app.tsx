/**
 * Quorum Daemon TUI — root application component.
 *
 * Renders the enforcement dashboard: audit gate status, agent activity,
 * track progress, and event stream. The gate visualization is the core —
 * it shows WHY something is blocked, not just that it is.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { QuorumBus } from "../bus/bus.js";
import type { QuorumEvent } from "../bus/events.js";
import { listProviders } from "../providers/provider.js";
import { GateStatus } from "./components/GateStatus.js";
import { AuditStream } from "./components/AuditStream.js";
import { AgentPanel } from "./components/AgentPanel.js";
import { TrackProgress } from "./components/TrackProgress.js";
import { Header } from "./components/Header.js";

interface AppProps {
  bus: QuorumBus;
}

export function App({ bus }: AppProps) {
  const { exit } = useApp();
  const [events, setEvents] = useState<QuorumEvent[]>(bus.recent(50));
  const [activeView, setActiveView] = useState<"dashboard" | "log">("dashboard");

  useEffect(() => {
    const handler = (event: QuorumEvent) => {
      setEvents((prev) => [...prev.slice(-99), event]);
    };
    bus.on("*", handler);
    return () => bus.off("*", handler);
  }, [bus]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) exit();
    if (input === "1") setActiveView("dashboard");
    if (input === "2") setActiveView("log");
  });

  const providers = listProviders().map((p) => ({
    name: p.displayName,
    ...p.status(),
  }));

  return (
    <Box flexDirection="column" padding={1}>
      <Header activeView={activeView} providers={providers} />

      {activeView === "dashboard" ? (
        <Box flexDirection="column" gap={1}>
          {/* Top row: gate + agents */}
          <Box gap={2}>
            <GateStatus events={events} />
            <AgentPanel events={events} />
          </Box>

          {/* Bottom row: tracks + audit stream */}
          <Box gap={2}>
            <TrackProgress events={events} />
            <AuditStream events={events} />
          </Box>
        </Box>
      ) : (
        <AuditStream events={events} fullScreen />
      )}

      <Box marginTop={1}>
        <Text dimColor>
          [1] Dashboard  [2] Full Log  [q] Quit
        </Text>
      </Box>
    </Box>
  );
}
