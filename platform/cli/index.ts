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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/platform/cli/ → project root is 3 levels up
const QUORUM_ROOT = resolve(__dirname, "..", "..", "..");

function getVersion(): string {
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    // Try QUORUM_ROOT first, then one level up (dist/platform/cli/.. → dist/platform/, need dist/../package.json)
    const candidates = [resolve(QUORUM_ROOT, "package.json"), resolve(QUORUM_ROOT, "..", "package.json")];
    const pkgPath = candidates.find(p => { try { readFileSync(p); return true; } catch (err) { console.warn(`[cli] package.json read failed for ${p}: ${(err as Error).message}`); return false; } });
    if (!pkgPath) return "unknown";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "unknown";
  } catch (err) {
    console.warn(`[cli] version detection failed: ${(err as Error).message}`);
    return "unknown";
  }
}

const [command, ...args] = process.argv.slice(2);

const COMMANDS: Record<string, { description: string; handler: () => Promise<void> }> = {
  setup: {
    description: "Register MCP server + generate config",
    handler: () => import("./commands/setup.js").then((m) => m.run(args)),
  },
  interview: {
    description: "→ orchestrate plan (deprecated: use orchestrate plan <track>)",
    handler: () => {
      console.log("\x1b[33mDeprecated:\x1b[0m interview is now 'quorum orchestrate plan <track>'\n");
      console.log("  quorum orchestrate plan <track> [--provider claude|codex|gemini|ollama|vllm]\n");
      console.log("Features: LLM-powered Socratic questioning, any language,");
      console.log("CPS auto-intake from parliament, parliament feedback loop.\n");
      return Promise.resolve();
    },
  },
  daemon: {
    description: "Start TUI dashboard (persistent)",
    handler: () => import("../../daemon/index.js").then((m) => m.default?.()),
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
  parliament: {
    description: "Run parliamentary deliberation on a topic",
    handler: () => import("./commands/parliament.js").then((m) => m.run(args)),
  },
  ask: {
    description: "→ deprecated (use provider CLI directly, or orchestrate plan)",
    handler: () => {
      console.log("\x1b[33mDeprecated:\x1b[0m 'ask' adds no quorum context.\n");
      console.log("  Direct query:      claude -p \"prompt\"");
      console.log("  Interactive plan:  quorum orchestrate plan <track>");
      console.log("  Agent relay:       quorum agent attach <session-id>\n");
      return Promise.resolve();
    },
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
  doctor: {
    description: "Diagnose issues that could trap agents",
    handler: () => import("./commands/doctor.js").then((m) => m.run(args)),
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
  quorum parliament "topic"    Run parliamentary deliberation
  quorum ask codex "review"   Ask Codex to review
  quorum tool code_map        Run code_map analysis

\x1b[2mv${getVersion()}\x1b[0m
`);
}

export async function main(): Promise<void> {
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
