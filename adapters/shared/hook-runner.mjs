/**
 * HookRunner — generic hook execution engine.
 *
 * Ported from SoulFlow-Orchestrator src/hooks/runner.ts + types.ts.
 * Supports command (spawn) and http (POST) handlers with:
 * - Environment variable interpolation ($VAR, ${VAR})
 * - Matcher-based filtering (regex on tool_name)
 * - Deny-first-break semantics (sync hooks stop on first deny)
 * - Async fire-and-forget hooks
 * - Fail-open: errors → { decision: "ignore" }
 *
 * No adapter-specific I/O — pure engine. Used by all adapters.
 *
 * @module adapters/shared/hook-runner
 */

import { spawn } from "node:child_process";

/**
 * @typedef {"PreToolUse"|"PostToolUse"|"PostToolUseFailure"|"SessionStart"|"SessionEnd"|"Stop"|"SubagentStart"|"SubagentStop"|"TaskCompleted"|"Notification"|string} HookEventName
 *
 * @typedef {"command"|"http"} HookHandlerType
 *
 * @typedef {{ type: "command", command: string, cwd?: string, timeout_ms?: number }} CommandHookHandler
 * @typedef {{ type: "http", url: string, headers?: Record<string, string>, timeout_ms?: number }} HttpHookHandler
 * @typedef {CommandHookHandler|HttpHookHandler} HookHandler
 *
 * @typedef {{ name: string, event: HookEventName, matcher?: string, handler: HookHandler, async?: boolean, disabled?: boolean }} HookDefinition
 *
 * @typedef {{ hook_event_name: HookEventName, session_id?: string, cwd?: string, tool_name?: string, tool_input?: Record<string, unknown>, tool_output?: string, is_error?: boolean, metadata?: Record<string, unknown> }} HookInput
 *
 * @typedef {{ decision?: "allow"|"deny"|"ignore", reason?: string, updated_input?: Record<string, unknown>, additional_context?: string }} HookOutput
 *
 * @typedef {{ hook_name: string, output: HookOutput, duration_ms: number, error?: string }} HookExecutionResult
 */

/** Environment variable interpolation: $VAR or ${VAR} → process.env[VAR]. */
export function interpolateEnv(text) {
  return text.replace(/\$\{([^}]+)\}|\$([A-Za-z_]\w*)/g, (_match, braced, bare) => {
    const key = braced || bare;
    return process.env[key] || "";
  });
}

/** Parse stdout/body JSON. Returns null on failure. */
export function parseHookJson(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    return {
      decision: obj.decision || undefined,
      reason: typeof obj.reason === "string" ? obj.reason : undefined,
      updated_input: obj.updated_input && typeof obj.updated_input === "object"
        ? obj.updated_input : undefined,
      additional_context: typeof obj.additional_context === "string"
        ? obj.additional_context : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Run a command hook. Sends HookInput as JSON on stdin, parses stdout JSON.
 * Exit code 2 = deny. Non-zero (except 2) = ignore. Zero = allow (or parsed output).
 *
 * @param {string} command — shell command (env vars interpolated)
 * @param {HookInput} input
 * @param {string} cwd
 * @param {number} timeout_ms
 * @returns {Promise<HookOutput>}
 */
export function runCommandHook(command, input, cwd, timeout_ms) {
  const resolved = interpolateEnv(command);
  return new Promise((resolve) => {
    // DEP0190: pass command as single string (no args array) when using shell
    const child = spawn(resolved, {
      shell: true,
      cwd,
      timeout: timeout_ms,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOOK_EVENT: input.hook_event_name },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.stdin.on("error", () => {}); // suppress EPIPE if process exits before write drains
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();

    child.on("error", (err) => {
      resolve({ decision: "ignore", reason: `spawn_error: ${err.message}` });
    });

    child.on("close", (code) => {
      if (code === 2) {
        const parsed = parseHookJson(stdout);
        resolve({
          decision: "deny",
          reason: parsed?.reason || stderr.trim() || `hook exited with code 2`,
          additional_context: parsed?.additional_context,
        });
        return;
      }
      if (code !== 0) {
        resolve({ decision: "ignore", reason: `hook exited with code ${code}: ${stderr.trim().slice(0, 200)}` });
        return;
      }
      resolve(parseHookJson(stdout) || { decision: "allow" });
    });
  });
}

/**
 * Run an HTTP hook. POST HookInput as JSON, parse response.
 *
 * @param {string} url
 * @param {HookInput} input
 * @param {Record<string, string>} headers
 * @param {number} timeout_ms
 * @returns {Promise<HookOutput>}
 */
export async function runHttpHook(url, input, headers, timeout_ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      return { decision: "ignore", reason: `http_${response.status}` };
    }
    const text = await response.text();
    return parseHookJson(text) || { decision: "allow" };
  } catch (err) {
    clearTimeout(timer);
    return { decision: "ignore", reason: `http_error: ${err?.message || err}` };
  }
}

/**
 * HookRunner — manages hook definitions and fires them on events.
 *
 * Ported from SoulFlow HookRunner class.
 * - Sync hooks run sequentially, stop on first deny
 * - Async hooks fire-and-forget
 * - Matcher filters on tool_name (regex)
 * - Fail-open: errors → ignore
 */
export class HookRunner {
  /** @type {Map<string, HookDefinition[]>} */
  #hooks = new Map();
  /** @type {string} */
  #workspace;

  /**
   * @param {string} workspace — working directory for command hooks
   * @param {{ hooks?: Record<string, HookDefinition[]> }} [config] — initial hook definitions
   */
  constructor(workspace, config) {
    this.#workspace = workspace;
    if (config?.hooks) {
      for (const [event, defs] of Object.entries(config.hooks)) {
        const active = (defs || []).filter((d) => !d.disabled);
        for (const d of active) this.#compileMatcher(d);
        if (active.length > 0) {
          this.#hooks.set(event, active);
        }
      }
    }
  }

  /** Pre-compile matcher regex on definition (avoids per-fire() allocation). */
  #compileMatcher(def) {
    if (def.matcher) {
      try { def._matcherRe = new RegExp(def.matcher); } catch { def._matcherRe = null; }
    }
  }

  /** Add a hook definition. Ignored if disabled. */
  add(definition) {
    if (definition.disabled) return;
    this.#compileMatcher(definition);
    const list = this.#hooks.get(definition.event) || [];
    list.push(definition);
    this.#hooks.set(definition.event, list);
  }

  /** Check if any hooks registered for event. */
  has(event) {
    return (this.#hooks.get(event)?.length ?? 0) > 0;
  }

  /** List all registered hooks. */
  listHooks() {
    const result = [];
    for (const [event, defs] of this.#hooks) {
      for (const d of defs) {
        result.push({ event, name: d.name, handlerType: d.handler.type });
      }
    }
    return result;
  }

  /**
   * Fire all hooks for an event.
   * Sync hooks run sequentially — first deny stops execution.
   * Async hooks fire-and-forget.
   *
   * @param {string} event
   * @param {HookInput} input
   * @returns {Promise<HookExecutionResult[]>}
   */
  async fire(event, input) {
    const defs = this.#hooks.get(event);
    if (!defs || defs.length === 0) return [];

    const results = [];
    for (const def of defs) {
      // Matcher filtering (tool events) — uses pre-compiled regex
      if (def.matcher && input.tool_name) {
        const re = def._matcherRe;
        if (!re || !re.test(input.tool_name)) continue;
      }

      if (def.async) {
        this.#runSingle(def, input).catch(() => {});
        results.push({ hook_name: def.name, output: { decision: "ignore" }, duration_ms: 0 });
        continue;
      }

      const result = await this.#runSingle(def, input);
      results.push(result);

      // Deny stops subsequent hooks
      if (result.output.decision === "deny") break;
    }
    return results;
  }

  /**
   * @param {HookDefinition} def
   * @param {HookInput} input
   * @returns {Promise<HookExecutionResult>}
   */
  async #runSingle(def, input) {
    const start = Date.now();
    try {
      /** @type {HookOutput} */
      let output;
      if (def.handler.type === "command") {
        const cwd = def.handler.cwd || this.#workspace;
        const timeout = def.handler.timeout_ms ?? 10_000;
        output = await runCommandHook(def.handler.command, input, cwd, timeout);
      } else {
        const timeout = def.handler.timeout_ms ?? 5_000;
        output = await runHttpHook(
          def.handler.url,
          input,
          def.handler.headers || {},
          timeout,
        );
      }
      return { hook_name: def.name, output, duration_ms: Date.now() - start };
    } catch (err) {
      const msg = err?.message || String(err);
      return {
        hook_name: def.name,
        output: { decision: "ignore", reason: msg },
        duration_ms: Date.now() - start,
        error: msg,
      };
    }
  }
}
