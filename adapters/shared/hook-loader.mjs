/**
 * Hook configuration loader — loads HookDefinitions from HOOK.md and JSON config.
 *
 * Ported from SoulFlow-Orchestrator src/hooks/loader.ts.
 * Supports:
 * - HOOK.md YAML frontmatter parsing (lightweight, no external YAML lib)
 * - JSON config object conversion
 * - Multi-source config merging
 *
 * @module adapters/shared/hook-loader
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HOOK_EVENT_NAMES = new Set([
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "SessionStart", "SessionEnd", "Stop",
  "SubagentStart", "SubagentStop", "TaskCompleted", "Notification",
  // Gemini-specific
  "BeforeAgent", "AfterAgent", "BeforeTool", "AfterTool",
  "BeforeModel", "AfterModel", "BeforeToolSelection", "PreCompress",
]);

/** Extract YAML frontmatter from HOOK.md content. */
function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

/**
 * Lightweight YAML parser — hook definitions only.
 * No external YAML dependency. Handles the hook config structure:
 *
 * ```yaml
 * hooks:
 *   PreToolUse:
 *     - name: block-dangerous
 *       matcher: "exec|shell"
 *       handler:
 *         type: command
 *         command: "node scripts/check.js"
 *         timeout_ms: 5000
 *   PostToolUse:
 *     - name: log-usage
 *       handler:
 *         type: http
 *         url: "http://localhost:9090/hooks/log"
 *       async: true
 * ```
 *
 * @param {string} yaml
 * @returns {{ hooks: Record<string, import("./hook-runner.mjs").HookDefinition[]> }}
 */
function parseHooksYaml(yaml) {
  const result = { hooks: {} };
  const lines = yaml.split(/\r?\n/);
  let currentEvent = null;
  let currentDef = null;
  let currentHandler = null;
  let inHooks = false;
  let inHandler = false;
  let inHeaders = false;
  let currentHeaders = {};

  const flushDef = () => {
    if (currentDef && currentEvent && currentDef.name && currentDef.handler) {
      if (inHeaders && currentHandler && currentHandler.type === "http") {
        currentHandler.headers = { ...currentHeaders };
        currentHeaders = {};
        inHeaders = false;
      }
      if (!result.hooks[currentEvent]) result.hooks[currentEvent] = [];
      result.hooks[currentEvent].push(currentDef);
    }
    currentDef = null;
    currentHandler = null;
    inHandler = false;
    inHeaders = false;
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (/^hooks:\s*$/.test(trimmed)) { inHooks = true; continue; }
    if (!inHooks) continue;

    // Event name (2-space indent)
    const eventMatch = trimmed.match(/^ {2}(\w+):\s*$/);
    if (eventMatch && HOOK_EVENT_NAMES.has(eventMatch[1])) {
      flushDef();
      currentEvent = eventMatch[1];
      continue;
    }

    // New definition (4-space indent, list item)
    if (trimmed.match(/^ {4}- /)) {
      flushDef();
      currentDef = {};
      const nameMatch = trimmed.match(/^ {4}- name:\s*"?([^"]*)"?\s*$/);
      if (nameMatch) currentDef.name = nameMatch[1].trim();
      if (currentEvent) currentDef.event = currentEvent;
      continue;
    }

    // Handler nested properties (8-space indent)
    if (currentDef && inHandler && currentHandler && trimmed.match(/^ {8}\w/)) {
      const kv = trimmed.match(/^\s+(\w+):\s*(.*)$/);
      if (kv) {
        const [, key, rawVal] = kv;
        const val = (rawVal || "").replace(/^"(.*)"$/, "$1").trim();
        if (key === "type") currentHandler.type = val;
        else if (key === "command") currentHandler.command = val;
        else if (key === "url") currentHandler.url = val;
        else if (key === "timeout_ms") currentHandler.timeout_ms = Number(val) || undefined;
        else if (key === "cwd") currentHandler.cwd = val;
        else if (key === "headers") { inHeaders = true; currentHeaders = {}; }
        if (currentHandler.type) currentDef.handler = currentHandler;
      }
      continue;
    }

    // Headers (10-space indent)
    if (inHeaders && trimmed.match(/^ {10}\S/)) {
      const hdr = trimmed.match(/^\s+(\S+):\s*(.+)$/);
      if (hdr) currentHeaders[hdr[1]] = hdr[2].replace(/^"(.*)"$/, "$1").trim();
      continue;
    }

    // Definition properties (6-space indent)
    if (currentDef && trimmed.match(/^ {6}\w/)) {
      const kv = trimmed.match(/^\s+(\w+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, rawVal] = kv;
      const val = (rawVal || "").replace(/^"(.*)"$/, "$1").trim();

      if (key === "name") { currentDef.name = val; continue; }
      if (key === "matcher") { currentDef.matcher = val; continue; }
      if (key === "async") { currentDef.async = val === "true"; continue; }
      if (key === "disabled") { currentDef.disabled = val === "true"; continue; }

      if (key === "handler") {
        inHandler = true;
        currentHandler = {};
        continue;
      }

      // Legacy: handler properties at 6-space level
      if (inHandler && currentHandler) {
        if (key === "type") currentHandler.type = val;
        else if (key === "command") currentHandler.command = val;
        else if (key === "url") currentHandler.url = val;
        else if (key === "timeout_ms") currentHandler.timeout_ms = Number(val) || undefined;
        else if (key === "cwd") currentHandler.cwd = val;
        else if (key === "headers") { inHeaders = true; currentHeaders = {}; }
        if (currentHandler.type) currentDef.handler = currentHandler;
        continue;
      }
    }

    // Legacy headers (8-space indent)
    if (inHeaders && trimmed.match(/^ {8}/)) {
      const hdr = trimmed.match(/^\s+(\S+):\s*(.+)$/);
      if (hdr) currentHeaders[hdr[1]] = hdr[2].replace(/^"(.*)"$/, "$1").trim();
      continue;
    }

    // Top-level key → end hooks block
    if (trimmed.length > 0 && !trimmed.startsWith(" ")) {
      flushDef();
      inHooks = false;
    }
  }
  flushDef();
  return result;
}

/**
 * Load hook definitions from HOOK.md file.
 *
 * @param {string} workspace — directory containing the file
 * @param {string} [filename="HOOK.md"]
 * @returns {{ hooks: Record<string, import("./hook-runner.mjs").HookDefinition[]> }}
 */
export function loadHooksFromFile(workspace, filename = "HOOK.md") {
  const path = join(workspace, filename);
  if (!existsSync(path)) return { hooks: {} };
  try {
    const content = readFileSync(path, "utf-8");
    const fm = extractFrontmatter(content);
    if (!fm) return { hooks: {} };
    return parseHooksYaml(fm);
  } catch {
    return { hooks: {} };
  }
}

/**
 * Convert a JSON config object to HooksConfig.
 * Handles { hooks: { EventName: [...definitions] } } structure.
 *
 * @param {Record<string, unknown>|null|undefined} raw
 * @returns {{ hooks: Record<string, import("./hook-runner.mjs").HookDefinition[]> }}
 */
export function hooksConfigFromJson(raw) {
  if (!raw || typeof raw !== "object") return { hooks: {} };
  const hooksRaw = raw.hooks;
  if (!hooksRaw || typeof hooksRaw !== "object") return { hooks: {} };

  const result = { hooks: {} };
  for (const [event, defsRaw] of Object.entries(hooksRaw)) {
    if (!Array.isArray(defsRaw)) continue;
    result.hooks[event] = defsRaw
      .filter((d) => d !== null && typeof d === "object")
      .map((d) => ({
        name: String(d.name || "unnamed"),
        event,
        matcher: typeof d.matcher === "string" ? d.matcher : undefined,
        handler: d.handler,
        async: d.async === true,
        disabled: d.disabled === true,
      }));
  }
  return result;
}

/**
 * Merge multiple HooksConfig objects. Same-event hooks are concatenated.
 *
 * @param {...({ hooks: Record<string, import("./hook-runner.mjs").HookDefinition[]> }|null|undefined)} configs
 * @returns {{ hooks: Record<string, import("./hook-runner.mjs").HookDefinition[]> }}
 */
export function mergeHooksConfigs(...configs) {
  const result = { hooks: {} };
  for (const config of configs) {
    if (!config?.hooks) continue;
    for (const [event, defs] of Object.entries(config.hooks)) {
      if (!result.hooks[event]) result.hooks[event] = [];
      result.hooks[event].push(...defs);
    }
  }
  return result;
}
