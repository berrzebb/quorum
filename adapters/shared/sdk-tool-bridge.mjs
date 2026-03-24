/**
 * SDK Tool Bridge — JSON Schema → Zod conversion for SDK native tool loops.
 *
 * Ported from SoulFlow-Orchestrator src/agent/backends/sdk-tool-bridge.ts.
 * Enables quorum's MCP tools to be exposed as native SDK tools
 * (e.g., Claude Agent SDK's in-process MCP server).
 *
 * Optional dependency: @anthropic-ai/claude-agent-sdk + zod.
 * Returns null if dependencies are unavailable.
 *
 * @module adapters/shared/sdk-tool-bridge
 */

/**
 * @typedef {{ name: string, description: string, parameters: object, execute: (params: Record<string, unknown>) => Promise<unknown> }} ToolLike
 */

/**
 * Wrap ToolLike objects as an SDK in-process MCP server.
 *
 * @param {string} name — server name
 * @param {ToolLike[]} tools — quorum tools to expose
 * @returns {Promise<Record<string, unknown>|null>} SDK mcpServers config, or null if SDK unavailable
 */
export async function createSdkToolServer(name, tools) {
  if (!tools || tools.length === 0) return null;

  try {
    const sdk = await import(/* webpackIgnore: true */ "@anthropic-ai/claude-agent-sdk");
    const createServer = sdk.createSdkMcpServer;
    const createTool = sdk.tool;
    if (!createServer || !createTool) return null;

    const { z } = await import(/* webpackIgnore: true */ "zod");

    const sdkTools = tools.map((t) =>
      createTool(
        t.name,
        t.description || t.name,
        jsonSchemaToZodShape(t.parameters, z),
        async (args) => {
          try {
            const result = await t.execute(args);
            const text = typeof result === "string" ? result : JSON.stringify(result ?? "");
            return { content: [{ type: "text", text }] };
          } catch (e) {
            return { content: [{ type: "text", text: `Error: ${e?.message || e}` }], isError: true };
          }
        },
      ),
    );

    return createServer({ name, tools: sdkTools });
  } catch {
    return null;
  }
}

/**
 * Convert JSON Schema to Zod shape (top-level properties).
 *
 * @param {object} schema — JSON Schema { type: "object", properties: {...}, required: [...] }
 * @param {object} z — Zod module
 * @returns {Record<string, unknown>} Zod shape object
 */
export function jsonSchemaToZodShape(schema, z) {
  const shape = {};
  const props = schema?.properties || {};
  const requiredSet = new Set(Array.isArray(schema?.required) ? schema.required : []);

  for (const [key, propSchema] of Object.entries(props)) {
    const base = jsonPropToZod(propSchema, z);
    shape[key] = requiredSet.has(key) ? base : base.optional();
  }
  return shape;
}

/**
 * Convert a single JSON Schema property to Zod type.
 *
 * @param {object} prop — JSON Schema property
 * @param {object} z — Zod module
 * @returns {unknown} Zod type
 */
export function jsonPropToZod(prop, z) {
  let base;
  switch (prop?.type) {
    case "string":
      base = Array.isArray(prop.enum) && prop.enum.length > 0
        ? z.enum(prop.enum)
        : z.string();
      break;
    case "number":
    case "integer":
      base = z.number();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array":
      base = z.array(prop.items ? jsonPropToZod(prop.items, z) : z.unknown());
      break;
    case "object":
      base = prop.properties
        ? z.object(jsonSchemaToZodShape(prop, z))
        : z.record(z.string(), z.unknown());
      break;
    default:
      base = z.unknown();
      break;
  }
  return prop?.description ? base.describe(prop.description) : base;
}
