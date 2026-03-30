/**
 * Quorum Daemon TUI — root application component.
 *
 * Thin shell that delegates to view components via the app-shell reducer.
 * Handles event subscription, state polling, mux session sync, and view routing.
 */

import React, { useState, useEffect, useMemo, useReducer } from "react";
import { Box, Text, useApp, useInput } from "ink";
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
  return `${lastEvent}:${s.tracks.length}:${s.parliament.liveSessions.length}:${s.parliament.sessionCount}:${s.agentQueries.length}:${s.locks.length}:${s.findingStats.total}:${s.fitness.current ?? 0}`;
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
    const poll = setInterval(update, 1000);
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

    // Focus cycling via tab/shift+tab
    if (key.tab) {
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

  return (
    <Box flexDirection="column" padding={1}>
      <Header activeView={shell.activeView} providers={providers} />

      {shell.activeView === "overview" && (
        <OverviewView
          state={fullState}
          events={events}
          width={process.stdout.columns || 120}
          height={process.stdout.rows || 24}
        />
      )}

      {shell.activeView === "review" && (
        <ReviewView
          state={fullState}
          events={events}
          width={process.stdout.columns || 120}
          height={process.stdout.rows || 24}
        />
      )}

      {shell.activeView === "chat" && (
        <ChatView
          state={fullState}
          mux={mux ?? null}
          liveSessions={fullState?.parliament.liveSessions ?? []}
          width={process.stdout.columns || 120}
          height={process.stdout.rows || 24}
        />
      )}

      {shell.activeView === "operations" && (
        <OperationsView
          state={fullState}
          width={process.stdout.columns || 120}
          height={process.stdout.rows || 24}
        />
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {hintText}  [q] Quit
        </Text>
      </Box>
    </Box>
  );
}
