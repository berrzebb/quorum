/**
 * quorum setup — one-shot project initialization.
 *
 * 1. Generate config.json if missing
 * 2. Register MCP server in .mcp.json
 * 3. Set up feedback directory structure
 * 4. Optionally install Claude Code adapter hooks
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Resolve to the quorum package root (works for global, local, and npm link). */
const QUORUM_PKG_ROOT = resolve(__dirname, "..", "..", "..");

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const quorumDir = resolve(repoRoot, ".claude", "quorum");
  const steps: { label: string; ok: boolean }[] = [];

  console.log("\n\x1b[36mquorum setup\x1b[0m — initializing project\n");

  // 1. Config directory
  if (!existsSync(quorumDir)) {
    mkdirSync(quorumDir, { recursive: true });
    steps.push({ label: "Created .claude/quorum/", ok: true });
  } else {
    steps.push({ label: ".claude/quorum/ exists", ok: true });
  }

  // 2. Config file
  const configPath = resolve(quorumDir, "config.json");
  if (!existsSync(configPath)) {
    const defaultConfig = {
      plugin: {
        locale: "en",
        audit_script: "audit.mjs",
        respond_script: "respond.mjs",
        hooks_enabled: {
          audit: true,
          session_gate: true,
          quality_rules: true,
        },
      },
      consensus: {
        watch_file: "docs/feedback/claude.md",
        trigger_tag: "[REVIEW_NEEDED]",
        agree_tag: "[APPROVED]",
        pending_tag: "[CHANGES_REQUESTED]",
        planning_dirs: ["docs/design"],
      },
      quality_rules: [],
    };
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n");
    steps.push({ label: "Generated config.json", ok: true });
  } else {
    steps.push({ label: "config.json exists", ok: true });
  }

  // 3. Feedback directory
  const feedbackDir = resolve(repoRoot, "docs", "feedback");
  if (!existsSync(feedbackDir)) {
    mkdirSync(feedbackDir, { recursive: true });
    writeFileSync(resolve(feedbackDir, "claude.md"), "# Evidence\n\nNo submissions yet.\n");
    steps.push({ label: "Created docs/feedback/", ok: true });
  } else {
    steps.push({ label: "docs/feedback/ exists", ok: true });
  }

  // 4. MCP server registration
  const mcpPath = resolve(repoRoot, ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, "utf8"));
    } catch { /* fresh start */ }
  }

  const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
  if (!mcpServers.quorum) {
    const mcpServerPath = resolve(QUORUM_PKG_ROOT, "core", "tools", "mcp-server.mjs");
    mcpServers.quorum = {
      command: "node",
      args: [mcpServerPath],
      type: "stdio",
    };
    mcpConfig.mcpServers = mcpServers;
    writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    steps.push({ label: "Registered MCP server", ok: true });
  } else {
    steps.push({ label: "MCP server already registered", ok: true });
  }

  // Summary
  console.log("  Steps:");
  for (const step of steps) {
    console.log(`  ${step.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${step.label}`);
  }

  console.log(`\n\x1b[32mSetup complete.\x1b[0m`);
  console.log(`\nNext steps:`);
  console.log(`  quorum daemon     Start the TUI dashboard`);
  console.log(`  quorum status     Check gate status`);
  console.log(`  quorum help       See all commands\n`);
}
