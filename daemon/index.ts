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

  // ── 9. Render TUI ──
  const { waitUntilExit } = render(
    React.createElement(App, { bus, stateReader, mux: daemonMux }),
  );

  // ── 10. Graceful shutdown ──
  await waitUntilExit();
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
