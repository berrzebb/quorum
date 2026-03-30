/**
 * Shared test helpers — temp store creation and cleanup.
 */

import { resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const { EventStore } = await import("../dist/platform/bus/store.js");

export function createTempStore() {
  const dir = resolve(tmpdir(), `quorum-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = resolve(dir, "test.db");
  const store = new EventStore({ dbPath });
  return { store, dir, dbPath };
}

export function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (err) { console.warn("helpers cleanup failed:", err?.message ?? err); }
}
