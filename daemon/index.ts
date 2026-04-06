#!/usr/bin/env node
/**
 * Quorum Daemon — persistent TUI process that orchestrates the audit cycle.
 *
 * Starts the event bus, connects providers, and renders the Ink dashboard.
 * Can be invoked directly or via `quorum daemon`.
 *
 * This is a thin entry point that delegates to extracted services:
 * - daemon-bootstrap: EventStore, QuorumBus, config, state bootstrap
 * - provider-lifecycle: provider registration and cleanup
 * - mux-lifecycle: ProcessMux session wrapper and agent mux
 */

import { resolve } from "node:path";
import React from "react";
import { render } from "ink";
import { MessageBus } from "../platform/bus/message-bus.js";
import { StateReader } from "./state-reader.js";
import { App } from "./app.js";

import { initializeStore, loadConfig, bootstrapFromState, startConfigRefresh } from "./services/daemon-bootstrap.js";
import { startProviders } from "./services/provider-lifecycle.js";
import { tryWrapInMuxSession, initializeMux } from "./services/mux-lifecycle.js";

export default async function startDaemon(args: string[] = []): Promise<void> {
  const repoRoot = process.cwd();

  // ── 1. Mux session wrapper (opt-in via --mux flag) ──
  if (args.includes("--mux")) {
    const { wrapped } = await tryWrapInMuxSession(repoRoot);
    if (wrapped) return;
  }

  // ── 2. Init store + bus ──
  const dbPath = resolve(repoRoot, ".claude", "quorum-events.db");
  const { store, bus } = initializeStore(dbPath);

  // ── 3. Load config ──
  const config = loadConfig(repoRoot);

  // ── 4. Start providers ──
  const providers = await startProviders(bus, config);

  // ── 5. MessageBus + StateReader ──
  const messageBus = new MessageBus(store);
  const stateReader = new StateReader(store, messageBus);

  // ── 6. Bootstrap from state (only when SQLite has no prior events) ──
  const hasExistingData = store.query({ limit: 1 }).length > 0;
  if (!hasExistingData) {
    bootstrapFromState(repoRoot, config, bus);
  }

  // ── 7. Start config refresh loop ──
  const stopConfigRefresh = await startConfigRefresh();

  // ── 8. Init ProcessMux for agent sessions ──
  const daemonMux = await initializeMux();

  // ── 9. Enter alternate screen + render TUI ──
  // Alt screen prevents scroll jumping: fixed viewport, no scrollback interference
  const ENTER_ALT = "\x1b[?1049h\x1b[2J\x1b[H";
  const EXIT_ALT = "\x1b[?1049l";
  process.stdout.write(ENTER_ALT);
  // Ensure alt screen is exited on unexpected termination
  process.on("exit", () => {
    try { process.stdout.write(EXIT_ALT + "\x1b[?25h"); } catch { /* ignore */ }
  });

  const { waitUntilExit } = render(
    React.createElement(App, { bus, stateReader, mux: daemonMux }),
    { incrementalRendering: true, concurrent: true },
  );

  // ── 10. Graceful shutdown ──
  await waitUntilExit();
  // Restore terminal fully: exit alt screen, show cursor, reset SGR, reset DECSET modes
  process.stdout.write(
    EXIT_ALT +       // Exit alternate screen buffer
    "\x1b[?25h" +    // Show cursor (DECTCEM)
    "\x1b[0m" +      // Reset SGR (colors/bold)
    "\x1b[?1000l" +  // Disable mouse tracking
    "\x1b[?1006l" +  // Disable SGR mouse
    "\x1b[?2004l"    // Disable bracketed paste
  );
  // Ensure stdin raw mode is off (Ink leaves it on)
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    try { process.stdin.resume(); process.stdin.pause(); } catch { /* reset stdin state */ }
  }
  process.stdin.unref();
  stopConfigRefresh();
  await providers.cleanup();
  store.close();
}

// Direct invocation: node daemon/index.ts
import { fileURLToPath } from "node:url";
const __daemon_filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === __daemon_filename;
if (isDirectRun) {
  startDaemon().catch((err) => {
    console.error("Daemon failed to start:", err);
    process.exit(1);
  });
}
