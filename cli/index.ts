#!/usr/bin/env node
/**
 * Quorum CLI — unified entry point for all quorum operations.
 *
 * Usage: quorum <command> [options]
 *
 * Commands:
 *   setup          Register MCP server + generate config
 *   daemon         Start TUI dashboard (persistent)
 *   status         Show current audit gate status
 *   audit          Trigger manual audit
 *   plan           Work breakdown planning
 *   ask <provider> Query a provider directly
 *   tool <name>    Run MCP analysis tool
 *   help           Show this help message
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUORUM_ROOT = resolve(__dirname, "..");

const [command, ...args] = process.argv.slice(2);

const COMMANDS: Record<string, { description: string; handler: () => Promise<void> }> = {
  setup: {
    description: "Register MCP server + generate config",
    handler: () => import("./commands/setup.js").then((m) => m.run(args)),
  },
  interview: {
    description: "Interactive requirement clarification",
    handler: () => import("./commands/interview.js").then((m) => m.run(args)),
  },
  daemon: {
    description: "Start TUI dashboard (persistent)",
    handler: () => import("../daemon/index.js").then((m) => m.default?.()),
  },
  status: {
    description: "Show current audit gate status",
    handler: () => import("./commands/status.js").then((m) => m.run(args)),
  },
  audit: {
    description: "Trigger manual audit",
    handler: () => import("./commands/audit.js").then((m) => m.run(args)),
  },
  plan: {
    description: "Work breakdown planning",
    handler: () => import("./commands/plan.js").then((m) => m.run(args)),
  },
  orchestrate: {
    description: "Select track, distribute to agents, monitor",
    handler: () => import("./commands/orchestrate.js").then((m) => m.run(args)),
  },
  agent: {
    description: "Manage agent processes (spawn/list/capture/kill)",
    handler: () => import("./commands/agent.js").then((m) => m.run(args)),
  },
  ask: {
    description: "Query a provider directly",
    handler: () => import("./commands/ask.js").then((m) => m.run(args)),
  },
  tool: {
    description: "Run MCP analysis tool",
    handler: () => import("./commands/tool.js").then((m) => m.run(args)),
  },
  verify: {
    description: "Run done-criteria checks (CQ/T/TEST)",
    handler: () => import("./commands/verify.js").then((m) => m.run(args)),
  },
  retro: {
    description: "Retrospective after audit approval",
    handler: () => import("./commands/retro.js").then((m) => m.run(args)),
  },
  merge: {
    description: "Squash-merge worktree branch",
    handler: () => import("./commands/merge.js").then((m) => m.run(args)),
  },
  migrate: {
    description: "Import consensus-loop data into quorum",
    handler: () => import("./commands/migrate.js").then((m) => m.run(args)),
  },
  help: {
    description: "Show this help message",
    handler: async () => showHelp(),
  },
};

function showHelp(): void {
  console.log(`
\x1b[36mquorum\x1b[0m — cross-model audit gate with structural enforcement

\x1b[1mUsage:\x1b[0m quorum <command> [options]

\x1b[1mCommands:\x1b[0m`);

  const maxLen = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(maxLen + 2)} ${cmd.description}`);
  }

  console.log(`
\x1b[1mExamples:\x1b[0m
  quorum setup                Initialize quorum in current project
  quorum daemon               Start TUI dashboard
  quorum status               Check audit gate status
  quorum audit                Trigger manual audit
  quorum ask codex "review"   Ask Codex to review
  quorum tool code_map        Run code_map analysis

\x1b[2mv${process.env.npm_package_version ?? "0.2.0"}\x1b[0m
`);
}

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(`\x1b[31mUnknown command: ${command}\x1b[0m\n`);
    showHelp();
    process.exit(1);
  }

  await cmd.handler();
}

main().catch((err) => {
  console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
  process.exit(1);
});
