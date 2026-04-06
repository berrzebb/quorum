/**
 * MCP Registrar — auto-register quorum MCP server for all supported models.
 *
 * Supported targets:
 *   - Claude Code: .mcp.json (project) + ~/.claude/settings.json (global)
 *   - Codex CLI:   codex.json (project)
 *   - Gemini CLI:  gemini-extension.json is already bundled in adapter
 *
 * All models point to the same mcp-server.mjs → same knowledge graph.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

export interface RegisterResult {
  target: string;
  path: string;
  action: "created" | "updated" | "exists" | "failed";
  error?: string;
}

interface McpServerEntry {
  command: string;
  args: string[];
  type?: string;
  cwd?: string;
}

function buildMcpEntry(mcpServerPath: string, repoRoot?: string): McpServerEntry {
  return {
    command: "node",
    args: [mcpServerPath],
    type: "stdio",
    ...(repoRoot ? { cwd: repoRoot } : {}),
  };
}

function readJsonSafe(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeJsonSafe(path: string, data: unknown): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

// ── Claude Code (.mcp.json) ─────────────────────

function registerClaudeProject(repoRoot: string, mcpServerPath: string): RegisterResult {
  const mcpPath = resolve(repoRoot, ".mcp.json");
  const config = readJsonSafe(mcpPath);
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;

  if (servers.quorum) {
    return { target: "claude-code", path: mcpPath, action: "exists" };
  }

  servers.quorum = buildMcpEntry(mcpServerPath);
  config.mcpServers = servers;

  return writeJsonSafe(mcpPath, config)
    ? { target: "claude-code", path: mcpPath, action: "created" }
    : { target: "claude-code", path: mcpPath, action: "failed", error: "write failed" };
}

// ── Claude Code Global (~/.claude/settings.json) ─

function registerClaudeGlobal(mcpServerPath: string): RegisterResult {
  const settingsPath = resolve(homedir(), ".claude", "settings.json");
  const config = readJsonSafe(settingsPath);

  // Ensure permissions include quorum MCP tools
  const perms = (config.permissions ?? {}) as Record<string, unknown>;
  const allow = (perms.allow ?? []) as string[];

  if (!allow.includes("mcp__quorum__*")) {
    allow.push("mcp__quorum__*");
    perms.allow = allow;
    config.permissions = perms;

    return writeJsonSafe(settingsPath, config)
      ? { target: "claude-global", path: settingsPath, action: "updated" }
      : { target: "claude-global", path: settingsPath, action: "failed", error: "write failed" };
  }

  return { target: "claude-global", path: settingsPath, action: "exists" };
}

// ── Codex CLI (codex.json or .codex/) ───────────

function registerCodex(repoRoot: string, mcpServerPath: string): RegisterResult {
  // Codex CLI uses codex.json at project root for MCP server config
  const codexPath = resolve(repoRoot, "codex.json");
  const config = readJsonSafe(codexPath);
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;

  if (servers.quorum) {
    return { target: "codex", path: codexPath, action: "exists" };
  }

  servers.quorum = buildMcpEntry(mcpServerPath, repoRoot);
  config.mcpServers = servers;

  // Preserve existing codex config fields
  if (!config.model) config.model = "o3"; // default model

  return writeJsonSafe(codexPath, config)
    ? { target: "codex", path: codexPath, action: "created" }
    : { target: "codex", path: codexPath, action: "failed", error: "write failed" };
}

// ── Gemini CLI ──────────────────────────────────

function registerGemini(repoRoot: string, mcpServerPath: string): RegisterResult {
  // Gemini CLI uses .gemini/settings.json for MCP
  const geminiDir = resolve(repoRoot, ".gemini");
  const settingsPath = resolve(geminiDir, "settings.json");
  const config = readJsonSafe(settingsPath);
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;

  if (servers.quorum) {
    return { target: "gemini", path: settingsPath, action: "exists" };
  }

  servers.quorum = {
    command: "node",
    args: [mcpServerPath],
    cwd: repoRoot,
  };
  config.mcpServers = servers;

  return writeJsonSafe(settingsPath, config)
    ? { target: "gemini", path: settingsPath, action: "created" }
    : { target: "gemini", path: settingsPath, action: "failed", error: "write failed" };
}

// ── Public API ──────────────────────────────────

/**
 * Register quorum MCP server for all supported models.
 * Idempotent — skips targets that already have quorum registered.
 *
 * @param repoRoot - Project root directory
 * @param quorumPkgRoot - Quorum package root (for resolving mcp-server.mjs)
 */
export function registerAllMcp(repoRoot: string, quorumPkgRoot: string): RegisterResult[] {
  const mcpServerPath = resolve(quorumPkgRoot, "platform", "core", "tools", "mcp-server.mjs");

  if (!existsSync(mcpServerPath)) {
    return [{ target: "all", path: mcpServerPath, action: "failed", error: "mcp-server.mjs not found" }];
  }

  return [
    registerClaudeProject(repoRoot, mcpServerPath),
    registerClaudeGlobal(mcpServerPath),
    registerCodex(repoRoot, mcpServerPath),
    registerGemini(repoRoot, mcpServerPath),
  ];
}

/**
 * Register for a specific target only.
 */
export function registerMcpFor(
  target: "claude" | "codex" | "gemini",
  repoRoot: string,
  quorumPkgRoot: string,
): RegisterResult {
  const mcpServerPath = resolve(quorumPkgRoot, "platform", "core", "tools", "mcp-server.mjs");

  switch (target) {
    case "claude": return registerClaudeProject(repoRoot, mcpServerPath);
    case "codex": return registerCodex(repoRoot, mcpServerPath);
    case "gemini": return registerGemini(repoRoot, mcpServerPath);
  }
}
