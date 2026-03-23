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
import type { StateReader, FullState } from "./state-reader.js";
import { listProviders } from "../providers/provider.js";
import { GateStatus } from "./components/GateStatus.js";
import { AuditStream } from "./components/AuditStream.js";
import { AgentPanel } from "./components/AgentPanel.js";
import { TrackProgress } from "./components/TrackProgress.js";
import { Header } from "./components/Header.js";

interface AppProps {
  bus: QuorumBus;
  stateReader?: StateReader;
}

export function App({ bus, stateReader }: AppProps) {
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

  // SQLite state polling (1s interval, <1ms per read)
  const [fullState, setFullState] = useState<FullState | null>(null);
  useEffect(() => {
    if (!stateReader) return;
    const poll = setInterval(() => {
      try { setFullState(stateReader.readAll()); } catch { /* non-critical */ }
    }, 1000);
    try { setFullState(stateReader.readAll()); } catch { /* initial read */ }
    return () => clearInterval(poll);
  }, [stateReader]);

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
          {/* Row 1: gate + item states */}
          <Box gap={2}>
            <GateStatus events={events} />
            {fullState && fullState.items.length > 0 && (
              <Box flexDirection="column" borderStyle="single" paddingX={1} width={40}>
                <Text bold>Item States</Text>
                {fullState.items.slice(0, 6).map((item) => (
                  <Text key={item.entityId}>
                    <Text color={
                      item.currentState === "approved" ? "green"
                      : item.currentState === "changes_requested" ? "red"
                      : "yellow"
                    }>
                      {item.entityId}
                    </Text>
                    {" "}
                    <Text dimColor>[{item.currentState}]</Text>
                    {" "}
                    <Text dimColor>{item.source}</Text>
                  </Text>
                ))}
              </Box>
            )}
          </Box>

          {/* Row 2: agents + locks + specialists */}
          <Box gap={2}>
            <AgentPanel events={events} />
            {fullState && fullState.locks.length > 0 && (
              <Box flexDirection="column" borderStyle="single" paddingX={1} width={30}>
                <Text bold>Active Locks</Text>
                {fullState.locks.map((lock) => {
                  const age = Math.round((Date.now() - (lock.acquiredAt ?? 0)) / 60000);
                  return (
                    <Text key={lock.lockName}>
                      <Text color="red">{lock.lockName}</Text>
                      {" "}
                      <Text dimColor>pid:{lock.owner} {age}m</Text>
                    </Text>
                  );
                })}
              </Box>
            )}
            {fullState && fullState.specialists.length > 0 && (
              <Box flexDirection="column" borderStyle="single" paddingX={1} width={35}>
                <Text bold>Specialists</Text>
                {fullState.specialists.slice(0, 5).map((s) => (
                  <Text key={s.domain}>
                    <Text color="cyan">{s.domain}</Text>
                    {s.tool && (
                      <Text>
                        {" "}
                        <Text color={s.toolStatus === "pass" ? "green" : s.toolStatus === "fail" ? "red" : "yellow"}>
                          {s.tool}:{s.toolStatus}
                        </Text>
                      </Text>
                    )}
                    {s.agent && (
                      <Text dimColor> {s.agent}</Text>
                    )}
                  </Text>
                ))}
              </Box>
            )}
          </Box>

          {/* Row 3: tracks + audit stream */}
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
