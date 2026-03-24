#!/usr/bin/env node
/**
 * Hook: PostToolUseFailure
 * Fires when a tool call fails. Tracks repeated failures for stagnation detection.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const input = JSON.parse(readFileSync("/dev/stdin", "utf8"));
  const toolName = input?.tool_name ?? "unknown";
  const error = input?.error ?? "";

  // Emit event to bus if available
  const bridgePath = resolve(__dirname, "..", "..", "core", "bridge.mjs");
  if (existsSync(bridgePath)) {
    const bridge = await import(bridgePath);
    if (bridge.emitEvent) {
      bridge.emitEvent("tool.failure", {
        tool: toolName,
        error: typeof error === "string" ? error.slice(0, 500) : String(error).slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    }
  }
} catch {
  // Hook must never block — fail silently
}
