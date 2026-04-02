#!/usr/bin/env node
/**
 * MCP Server — Exposes quorum deterministic scripts as native tools.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard)
 *
 * Configuration (.claude/settings.json or project settings):
 *   "mcpServers": {
 *     "quorum": {
 *       "command": "node",
 *       "args": [".claude/quorum/platform/core/tools/mcp-server.mjs"]
 *     }
 *   }
 *
 * Tool definitions and dispatch live in registry.mjs.
 * Capability filtering lives in tool-capabilities.mjs.
 */
import { createInterface } from "node:readline";
import { getAllTools, getTool } from "./registry.mjs";
import {
  toolsForRole,
  toolsForDomain,
  alwaysLoadTools,
} from "./tool-capabilities.mjs";

// ═══ MCP Protocol ═══════════════════════════════════════════════════════

const SERVER_INFO = { name: "quorum", version: "0.5.0" };

// ═══ Request handler ════════════════════════════════════════════════════

async function handleRequest(req) {
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };

    case "tools/list": {
      // Support role/domain filtering via cursor (MCP doesn't have params for tools/list)
      // Clients can pass filter hints via environment or init metadata.
      const role = process.env.QUORUM_AGENT_ROLE;
      const domains = (process.env.QUORUM_DETECTED_DOMAINS || "").split(",").filter(Boolean);

      const allTools = getAllTools().map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      if (!role && domains.length === 0) {
        return { tools: allTools };
      }

      // Build filtered tool set: always-load + role-allowed + domain-specific
      const allowed = new Set(alwaysLoadTools().map(t => t.name));
      if (role) {
        for (const t of toolsForRole(role)) allowed.add(t.name);
      }
      for (const d of domains) {
        for (const t of toolsForDomain(d)) allowed.add(t.name);
      }

      const filtered = allTools.filter(t => allowed.has(t.name));
      return { tools: filtered };
    }

    case "tools/call": {
      const { name, arguments: args } = req.params;
      const tool = getTool(name);

      if (!tool) {
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
      }

      try {
        const result = tool.async
          ? await tool.execute(args || {})
          : tool.execute(args || {});

        if (result.error) {
          return { content: [{ type: "text", text: result.stdout || result.error }], isError: true };
        }

        const tag = result.cached ? " [cached]" : "";
        const summary = result.summary ? `\n\n(${result.summary}${tag})` : (tag ? `\n\n(${tag.trim()})` : "");
        return { content: [{ type: "text", text: `${result.text}${summary}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Tool ${name} failed: ${err?.message ?? err}` }], isError: true };
      }
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    default:
      return null;
  }
}

// ═══ stdio transport ════════════════════════════════════════════════════

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch (err) { console.warn("[mcp-server] JSON parse failed:", err?.message ?? err); return; }

  const result = await handleRequest(req);
  if (result === null || req.id === undefined) return;

  const response = { jsonrpc: "2.0", id: req.id };
  if (result.error?.code) {
    response.error = result.error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + "\n");
});

rl.on("close", () => process.exit(0));
