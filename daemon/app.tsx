/**
 * Quorum Daemon TUI — root application component.
 *
 * Thin shell that delegates to view components via the app-shell reducer.
 * Handles event subscription, state polling, mux session sync, and view routing.
 */

import React, { useState, useEffect, useMemo, useReducer } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { QuorumBus } from "../platform/bus/bus.js";
import type { QuorumEvent } from "../platform/bus/events.js";
import type { StateReader, FullState } from "./state-reader.js";
import { listProviders } from "../platform/providers/provider.js";
import { Header } from "./components/Header.js";
import { OverviewView } from "./views/overview-view.js";
import { ReviewView } from "./views/review-view.js";
import { ChatView } from "./views/chat-view.js";
import { OperationsView } from "./views/operations-view.js";
import { shellReducer, initialShellState } from "./shell/app-shell.js";
import { viewForKey } from "./shell/navigation.js";
import { nextFocusInCycle, prevFocusInCycle } from "./shell/focus-regions.js";
import { getFooterHints } from "./shell/shortcuts.js";

/** Quick fingerprint to detect state changes without deep comparison. */
function stateFingerprint(s: FullState): string {
  const lastEvent = s.recentEvents[s.recentEvents.length - 1]?.timestamp ?? 0;
  return `${s.recentEvents.length}:${lastEvent}:${s.agentEvents.length}:${s.tracks.length}:${s.parliament.liveSessions.length}:${s.parliament.sessionCount}:${s.agentQueries.length}:${s.locks.length}:${s.findingStats.total}:${s.fitness.current ?? 0}`;
}

interface AppProps {
  bus: QuorumBus;
  stateReader?: StateReader;
  mux?: import("../platform/bus/mux.js").ProcessMux | null;
}

export function App({ bus, stateReader, mux }: AppProps) {
  const { exit } = useApp();
  const [events, setEvents] = useState<QuorumEvent[]>(bus.recent(50));
  const [shell, dispatch] = useReducer(shellReducer, undefined, initialShellState);

  // Event subscription
  useEffect(() => {
    const handler = (event: QuorumEvent) => {
      setEvents((prev) => [...prev.slice(-99), event]);
    };
    bus.on("*", handler);
    return () => bus.off("*", handler);
  }, [bus]);

  // Panel scroll states
  const [eventScrollOffset, setEventScrollOffset] = useState(0);

  // SQLite state polling (1s interval, <1ms per read)
  // Only trigger re-render when data fingerprint changes to avoid TUI flicker
  const [fullState, setFullState] = useState<FullState | null>(null);
  useEffect(() => {
    if (!stateReader) return;
    const update = () => {
      try {
        const next = stateReader.readAll(50);
        setFullState(prev => {
          if (!prev) return next;
          if (stateFingerprint(prev) === stateFingerprint(next)) return prev;
          return next;
        });
      } catch (err) { console.warn(`[app] state polling failed: ${(err as Error).message}`); }
    };
    update();
    const poll = setInterval(update, 3000);
    return () => clearInterval(poll);
  }, [stateReader]);

  // Sync external parliament mux sessions into daemon's mux for capture
  useEffect(() => {
    if (!mux || !fullState?.parliament.liveSessions) return;
    const live = fullState.parliament.liveSessions;
    const liveIds = new Set(live.map(s => s.id));

    // Register new external sessions
    for (const ls of live) {
      mux.registerExternal({
        id: ls.id,
        name: ls.name,
        backend: ls.backend as import("../platform/bus/mux.js").MuxBackend,
        startedAt: ls.startedAt,
        status: "running",
      });
    }

    // Unregister sessions that disappeared (CLI finished)
    for (const s of mux.list()) {
      if (s.name.startsWith("quorum-") && !liveIds.has(s.id)) {
        mux.unregister(s.id);
      }
    }
  }, [fullState?.parliament.liveSessions, mux]);

  // Sync agent sessions into daemon's mux — independent polling (3s)
  // Separate from fullState to detect .claude/agents/*.json changes (planner agents don't emit SQLite events)
  const [muxSessionCount, setMuxSessionCount] = useState(0);
  useEffect(() => {
    if (!mux) return;

    const syncAgents = () => {
      let changed = false;

      // Source 1: agent.spawn events from SQLite
      if (fullState?.agentEvents) {
        const completeIds = new Set(
          fullState.agentEvents.filter(e => e.type === "agent.complete").map(e => (e.payload.sessionId as string) ?? ""),
        );
        for (const ev of fullState.agentEvents) {
          if (ev.type !== "agent.spawn") continue;
          const p = ev.payload;
          const sessionId = p.sessionId as string | undefined;
          const backend = p.backend as string | undefined;
          if (!sessionId || !backend || backend === "unknown") continue;
          if (completeIds.has(sessionId)) continue;
          if (!mux.list().some(s => s.id === sessionId)) {
            mux.registerExternal({
              id: sessionId,
              name: (p.name as string) ?? `impl-${p.wbId ?? "agent"}`,
              backend: backend as import("../platform/bus/mux.js").MuxBackend,
              startedAt: ev.timestamp,
              status: "running",
            });
            changed = true;
          }
        }
      }

      // Source 2: .claude/agents/*.json files (planner sub-agents, orchestrate agents)
      const agentFileIds = new Set<string>();
      try {
        const agentsDir = resolve(process.cwd(), ".claude", "agents");
        if (existsSync(agentsDir)) {
          for (const f of readdirSync(agentsDir).filter(fn => fn.endsWith(".json"))) {
            try {
              const agent = JSON.parse(readFileSync(resolve(agentsDir, f), "utf8"));
              const sessionId = agent.id ?? agent.name ?? f.replace(".json", "");
              agentFileIds.add(sessionId);
              if (!mux.list().some(s => s.id === sessionId)) {
                mux.registerExternal({
                  id: sessionId,
                  name: agent.name ?? sessionId,
                  backend: (agent.backend ?? "psmux") as import("../platform/bus/mux.js").MuxBackend,
                  startedAt: agent.startedAt ?? Date.now(),
                  status: "running",
                });
                changed = true;
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch { /* no agents dir */ }

      // Unregister file-based sessions whose JSON was removed (agent completed)
      for (const s of mux.list()) {
        if (s.name.startsWith("quorum-") && !agentFileIds.has(s.id)) {
          mux.unregister(s.id);
          changed = true;
        }
      }

      // Only trigger re-render if session count actually changed
      const count = mux.list().filter(s => s.status === "running").length;
      setMuxSessionCount(prev => prev === count ? prev : count);
    };

    syncAgents();
    const timer = setInterval(syncAgents, 3000);
    return () => clearInterval(timer);
  }, [mux, fullState?.agentEvents?.length]);

  // Input handling: view switching, focus cycling, help overlay, quit
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) { exit(); return; }

    // View switching via 1/2/3/4
    const targetView = viewForKey(input);
    if (targetView) {
      dispatch({ type: "SET_VIEW", view: targetView });
      return;
    }

    // Help overlay toggle
    if (input === "?") {
      dispatch({ type: "SET_OVERLAY", overlay: shell.overlay === "help" ? "none" : "help" });
      return;
    }

    // Close overlay on escape
    if (key.escape && shell.overlay !== "none") {
      dispatch({ type: "SET_OVERLAY", overlay: "none" });
      return;
    }

    // Arrow keys: scroll focused panel
    if (key.upArrow) {
      if (shell.focusedRegion === "overview.tracks") {
        setEventScrollOffset(prev => prev + 3);
      }
      return;
    }
    if (key.downArrow) {
      if (shell.focusedRegion === "overview.tracks") {
        setEventScrollOffset(prev => Math.max(0, prev - 3));
      }
      return;
    }

    // Focus cycling via tab/shift+tab
    if (key.tab || input === "\t") {
      const next = key.shift
        ? prevFocusInCycle(shell.activeView, shell.focusedRegion)
        : nextFocusInCycle(shell.activeView, shell.focusedRegion);
      dispatch({ type: "SET_FOCUS", region: next });
      return;
    }
  });

  const providers = useMemo(() => listProviders().map((p) => ({
    name: p.displayName,
    ...p.status(),
  })), []);

  // Footer hints
  const hints = getFooterHints(shell.activeView, shell.focusedRegion, shell.overlay);
  const hintText = hints.map(h => `[${h.key}] ${h.description}`).join("  ");

  // Fixed layout: Header(3) + padding(2) + footer(1) = 6 lines overhead
  const termRows = process.stdout.rows || 24;
  const termCols = process.stdout.columns || 120;
  const viewHeight = Math.max(termRows - 6, 10);

  return (
    <Box flexDirection="column" padding={1} height={termRows}>
      <Header activeView={shell.activeView} providers={providers} />

      <Box height={viewHeight} overflowY="hidden">
        {shell.activeView === "overview" && (
          <OverviewView
            state={fullState}
            events={events}
            focusedRegion={shell.focusedRegion}
            eventScrollOffset={eventScrollOffset}
            width={termCols}
            height={viewHeight}
          />
        )}

        {shell.activeView === "review" && (
          <ReviewView
            state={fullState}
            events={events}
            focusedRegion={shell.focusedRegion}
            width={termCols}
            height={viewHeight}
          />
        )}

        {shell.activeView === "chat" && (
          <ChatView
            state={fullState}
            mux={mux ?? null}
            liveSessions={fullState?.parliament.liveSessions ?? []}
            agentEvents={fullState?.agentEvents ?? []}
            focusedRegion={shell.focusedRegion}
            width={termCols}
            height={viewHeight}
          />
        )}

        {shell.activeView === "operations" && (
          <OperationsView
            state={fullState}
            focusedRegion={shell.focusedRegion}
            width={termCols}
            height={viewHeight}
          />
        )}
      </Box>

      <Box height={1}>
        <Text dimColor>
          {hintText}  [q] Quit{shell.focusedRegion ? `  ▸ ${shell.focusedRegion}` : ""}
        </Text>
      </Box>
    </Box>
  );
}
