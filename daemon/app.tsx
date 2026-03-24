/**
 * Quorum Daemon TUI — root application component.
 *
 * Renders the enforcement dashboard: audit gate status, agent activity,
 * track progress, and event stream. The gate visualization is the core —
 * it shows WHY something is blocked, not just that it is.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { QuorumBus } from "../bus/bus.js";
import type { QuorumEvent } from "../bus/events.js";
import type { StateReader, FullState, FindingInfo, FindingStats, ReviewProgressInfo, FileThread } from "./state-reader.js";
import { listProviders } from "../providers/provider.js";
import { GateStatus } from "./components/GateStatus.js";
import { AuditStream } from "./components/AuditStream.js";
import { AgentPanel } from "./components/AgentPanel.js";
import { TrackProgress } from "./components/TrackProgress.js";
import { Header } from "./components/Header.js";
import { FitnessPanel } from "./components/FitnessPanel.js";

interface AppProps {
  bus: QuorumBus;
  stateReader?: StateReader;
}

export function App({ bus, stateReader }: AppProps) {
  const { exit } = useApp();
  const [events, setEvents] = useState<QuorumEvent[]>(bus.recent(50));
  const [activeView, setActiveView] = useState<"dashboard" | "log" | "chat">("dashboard");

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
    if (input === "3") setActiveView("chat");
  });

  const providers = useMemo(() => listProviders().map((p) => ({
    name: p.displayName,
    ...p.status(),
  })), [events]);

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

          {/* Row 2: agents + fitness + locks + specialists */}
          <Box gap={2}>
            <AgentPanel events={events} />
            {fullState && <FitnessPanel fitness={fullState.fitness} />}
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

          {/* Row 3: finding stats + open findings + review progress */}
          {fullState && fullState.findingStats.total > 0 && (
            <Box gap={2}>
              <FindingStatsPanel stats={fullState.findingStats} />
              <OpenFindingsPanel findings={fullState.findings} />
              {fullState.reviewProgress.length > 0 && (
                <ReviewProgressPanel progress={fullState.reviewProgress} />
              )}
            </Box>
          )}

          {/* Row 4: tracks + audit stream */}
          <Box gap={2}>
            <TrackProgress events={events} />
            <AuditStream events={events} />
          </Box>
        </Box>
      ) : activeView === "chat" ? (
        <ChatPanel fileThreads={fullState?.fileThreads ?? []} />
      ) : (
        <AuditStream events={events} fullScreen />
      )}

      <Box marginTop={1}>
        <Text dimColor>
          [1] Dashboard  [2] Full Log  [3] Chat  [q] Quit
        </Text>
      </Box>
    </Box>
  );
}

// ── Finding Stats Panel ──────────────────────

function FindingStatsPanel({ stats }: { stats: FindingStats }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={24}>
      <Text bold>Finding Stats</Text>
      <Text dimColor>{"─".repeat(20)}</Text>
      <Text>Total:     <Text bold>{stats.total}</Text></Text>
      <Text>Open:      <Text color="red" bold>{stats.open}</Text></Text>
      <Text>Confirmed: <Text color="yellow">{stats.confirmed}</Text></Text>
      <Text>Fixed:     <Text color="green">{stats.fixed}</Text></Text>
      <Text>Dismissed: <Text dimColor>{stats.dismissed}</Text></Text>
    </Box>
  );
}

// ── Open Findings Panel ──────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "red";
    case "major": return "yellow";
    case "minor": return "green";
    default: return "gray";
  }
}

function OpenFindingsPanel({ findings }: { findings: FindingInfo[] }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={60}>
      <Text bold>Open Findings</Text>
      <Text dimColor>{"─".repeat(56)}</Text>
      {findings.length === 0 ? (
        <Text dimColor>No open findings</Text>
      ) : (
        findings.slice(0, 8).map((f) => {
          const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "";
          const desc = f.description.length > 30
            ? f.description.slice(0, 30) + "..."
            : f.description;
          return (
            <Text key={f.id}>
              <Text dimColor>{f.id} </Text>
              <Text color={severityColor(f.severity)} bold={f.severity === "critical"}>
                {f.severity.padEnd(8)}
              </Text>
              {" "}
              {loc && <Text color="cyan">{loc} </Text>}
              <Text>{desc}</Text>
            </Text>
          );
        })
      )}
      {findings.length > 8 && (
        <Text dimColor>...and {findings.length - 8} more</Text>
      )}
    </Box>
  );
}

// ── Review Progress Panel ────────────────────

function ReviewProgressPanel({ progress }: { progress: ReviewProgressInfo[] }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={35}>
      <Text bold>Review Progress</Text>
      <Text dimColor>{"─".repeat(31)}</Text>
      {progress.map((r) => {
        const pct = Math.round(r.progress * 100);
        const barWidth = 16;
        const filled = Math.round((pct / 100) * barWidth);
        return (
          <Box key={r.reviewerId} flexDirection="column">
            <Text>
              <Text bold>{r.reviewerId}</Text>
              {" "}
              <Text dimColor>{r.provider}</Text>
            </Text>
            <Box>
              <Text color="green">{"█".repeat(filled)}</Text>
              <Text dimColor>{"░".repeat(barWidth - filled)}</Text>
              <Text dimColor> {pct}% </Text>
              <Text color="cyan">{r.phase}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Chat Panel (Review Threads) ─────────────

function msgTypeIcon(type: string): string {
  switch (type) {
    case "finding": return "●";
    case "reply": return "↳";
    case "ack": return "✓";
    case "resolve": return "✔";
    default: return "·";
  }
}

function msgColor(type: string, description?: string): string {
  switch (type) {
    case "finding": return "white";
    case "reply": return "cyan";
    case "ack": return description?.startsWith("fix") ? "green" : "yellow";
    case "resolve": return "green";
    default: return "gray";
  }
}

function ChatPanel({ fileThreads }: { fileThreads: FileThread[] }) {
  const hasThreads = fileThreads.some(ft => ft.threads.length > 0);
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Review Threads</Text>
      <Text dimColor>{"─".repeat(70)}</Text>
      {!hasThreads ? (
        <Text dimColor>No review threads yet</Text>
      ) : (
        fileThreads.map((ft) => (
          <Box key={ft.file} flexDirection="column" marginBottom={1}>
            <Text color="blue" bold>{ft.file}</Text>
            {ft.threads.map((thread) => (
              <Box key={thread.rootId} flexDirection="column" marginLeft={1}>
                {thread.messages.slice(0, 12).map((msg, i) => {
                  const indent = msg.type === "reply" || msg.type === "ack" || msg.type === "resolve" ? 2 : 0;
                  const desc = msg.description.length > 55
                    ? msg.description.slice(0, 55) + "..."
                    : msg.description;
                  const time = new Date(msg.timestamp).toLocaleTimeString("en-GB", {
                    hour: "2-digit", minute: "2-digit",
                  });
                  return (
                    <Text key={`${thread.rootId}-${i}`}>
                      {" ".repeat(indent)}
                      <Text color={msgColor(msg.type, msg.description)}>
                        {msgTypeIcon(msg.type)}
                      </Text>
                      {" "}
                      <Text dimColor>[{time}]</Text>
                      {" "}
                      <Text bold color="cyan">{msg.reviewerId}</Text>
                      {msg.severity && (
                        <Text color={severityColor(msg.severity)}> {msg.severity}</Text>
                      )}
                      {" "}
                      <Text>{desc}</Text>
                    </Text>
                  );
                })}
                {thread.messages.length > 12 && (
                  <Text dimColor>  ...{thread.messages.length - 12} more messages</Text>
                )}
                {!thread.open && (
                  <Text dimColor color="green">  [resolved]</Text>
                )}
              </Box>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}
