/**
 * quorum agent — manage agent processes via ProcessMux.
 *
 * Subcommands:
 *   spawn <name> <command>   Spawn an agent process
 *   list                     List active sessions
 *   capture <id>             Capture output from a session
 *   kill <id>                Kill a session
 *   cleanup                  Kill all sessions
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** At runtime: dist/platform/cli/commands/ → up 2 → dist/platform/ */
const DIST = resolve(__dirname, "..", "..");

/** Persist agent state to a JSON file so daemon can read it. */
function saveAgentState(repoRoot: string, id: string, data: Record<string, unknown>): void {
  const dir = resolve(repoRoot, ".claude", "agents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${id}.json`), JSON.stringify(data, null, 2));
}

function removeAgentState(repoRoot: string, id: string): void {
  const path = resolve(repoRoot, ".claude", "agents", `${id}.json`);
  try { if (existsSync(path)) rmSync(path); } catch { /* ignore */ }
}

/** Emit agent event to EventStore via bridge. */
async function emitAgentEvent(repoRoot: string, type: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    // Resolve from quorum package, not target project
    const quorumPkgRoot = resolve(__dirname, "..", "..", "..", "..");
    const bridge = await import(toURL(resolve(quorumPkgRoot, "platform", "core", "bridge.mjs")));
    await bridge.init(repoRoot);
    bridge.emitEvent(type, "claude-code", payload);
    bridge.close();
  } catch { /* non-critical */ }
}

export async function run(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    showHelp();
    return;
  }

  // Lazy import ProcessMux
  const toURL = (p: string) => pathToFileURL(p).href;
  const { ProcessMux, ensureMuxBackend } = await import(toURL(resolve(DIST, "bus", "mux.js")));

  switch (subcommand) {
    case "spawn": {
      const name = args[1];
      const command = args[2];
      const cmdArgs = args.slice(3);

      if (!name || !command) {
        console.log("  Usage: quorum agent spawn <name> <command> [args...]\n");
        return;
      }

      const backend = await ensureMuxBackend();
      const mux = new ProcessMux(backend);

      const session = await mux.spawn({
        name,
        command,
        args: cmdArgs,
        cwd: process.cwd(),
      });

      // Persist state for daemon visibility
      const repoRoot = process.cwd();
      saveAgentState(repoRoot, session.id, {
        id: session.id,
        name: session.name,
        pid: session.pid,
        backend: session.backend,
        command,
        args: cmdArgs,
        startedAt: session.startedAt,
        status: "running",
      });
      await emitAgentEvent(repoRoot, "agent.spawn", {
        name: session.name,
        role: "worker",
        pid: session.pid,
        backend: session.backend,
      });

      console.log(`\x1b[32m✓\x1b[0m Spawned: ${session.id}`);
      console.log(`  Name: ${session.name}`);
      console.log(`  PID: ${session.pid ?? "N/A"}`);
      console.log(`  Backend: ${session.backend}`);
      console.log(`\n  Capture: quorum agent capture ${session.id}`);
      console.log(`  Kill:    quorum agent kill ${session.id}\n`);

      // Keep process alive for raw backend
      if (session.backend === "raw") {
        console.log("  \x1b[2m(Process running in background. Use 'quorum agent kill' to stop.)\x1b[0m\n");
        mux.on("exit", (s: { id: string }) => {
          removeAgentState(repoRoot, s.id);
          emitAgentEvent(repoRoot, "agent.complete", { name: session.name });
        });
        await new Promise(() => {});
      }
      break;
    }

    case "list": {
      const backend = await ensureMuxBackend();
      const mux = new ProcessMux(backend);
      const sessions = mux.list();

      if (sessions.length === 0) {
        console.log("\n  No active sessions.\n");
        console.log("  Spawn one: quorum agent spawn <name> <command>\n");
        return;
      }

      console.log(`\n  Active sessions (${sessions.length}):\n`);
      for (const s of sessions) {
        const status = s.status === "running" ? "\x1b[32m●\x1b[0m" : s.status === "error" ? "\x1b[31m●\x1b[0m" : "\x1b[2m○\x1b[0m";
        const elapsed = Math.floor((Date.now() - s.startedAt) / 1000);
        console.log(`  ${status} ${s.id}`);
        console.log(`    Name: ${s.name} | PID: ${s.pid ?? "N/A"} | Backend: ${s.backend} | ${elapsed}s`);
      }
      console.log();
      break;
    }

    case "capture": {
      const sessionId = args[1];
      if (!sessionId) {
        console.log("  Usage: quorum agent capture <session-id> [--tail N]\n");
        return;
      }

      const tailLines = args.includes("--tail") ? parseInt(args[args.indexOf("--tail") + 1] ?? "50", 10) : 50;
      const backend = await ensureMuxBackend();
      const mux = new ProcessMux(backend);
      const result = mux.capture(sessionId, tailLines);

      if (!result) {
        console.log(`  Session not found or not running: ${sessionId}\n`);
        return;
      }

      console.log(`\n\x1b[2m--- ${sessionId} (${result.lines} lines) ---\x1b[0m\n`);
      console.log(result.output);
      console.log(`\n\x1b[2m--- end ---\x1b[0m\n`);
      break;
    }

    case "send": {
      const sessionId = args[1];
      const message = args.slice(2).join(" ");
      if (!sessionId || !message) {
        console.log("  Usage: quorum agent send <session-id> <message>\n");
        console.log("  Examples:");
        console.log('    quorum agent send impl-1 "/quorum:verify"');
        console.log('    quorum agent send impl-1 "switch to track B"\n');
        return;
      }

      const backend = await ensureMuxBackend();
      const mux = new ProcessMux(backend);
      const sent = mux.send(sessionId, message);

      if (sent) {
        console.log(`\x1b[32m✓\x1b[0m Sent to ${sessionId}: ${message}\n`);
      } else {
        console.log(`  Session not found or not running: ${sessionId}\n`);
      }
      break;
    }

    case "kill": {
      const sessionId = args[1];
      if (!sessionId) {
        console.log("  Usage: quorum agent kill <session-id>\n");
        return;
      }

      const backend = await ensureMuxBackend();
      const mux = new ProcessMux(backend);
      const killed = await mux.kill(sessionId);

      if (killed) {
        const repoRoot = process.cwd();
        removeAgentState(repoRoot, sessionId);
        await emitAgentEvent(repoRoot, "agent.complete", { name: sessionId });
        console.log(`\x1b[32m✓\x1b[0m Killed: ${sessionId}\n`);
      } else {
        console.log(`  Session not found: ${sessionId}\n`);
      }
      break;
    }

    case "attach": {
      const sessionId = args[1];
      if (!sessionId) {
        console.log("  Usage: quorum agent attach <session-id>\n");
        console.log("  Attaches to a mux session for interactive terminal relay.");
        console.log("  Detach: Ctrl+B D (tmux) or Ctrl+\\ (psmux)\n");
        return;
      }

      const { spawnSync } = await import("node:child_process");
      const attachBackend = await ensureMuxBackend();

      if (attachBackend === "raw") {
        // Raw backend: polling relay (stdin → send, capture → stdout)
        console.log(`\x1b[36mAttaching to ${sessionId} (raw relay)...\x1b[0m`);
        console.log(`\x1b[2mType messages. Ctrl+C to detach.\x1b[0m\n`);

        const attachMux = new ProcessMux("raw");
        const { createInterface: rl } = await import("node:readline");
        const iface = rl({ input: process.stdin, output: process.stdout, prompt: "\x1b[36m>\x1b[0m " });

        // Poll output in background
        const pollTimer = setInterval(() => {
          const cap = attachMux.capture(sessionId, 20);
          if (cap?.output) {
            process.stdout.write("\r" + cap.output + "\n");
            iface.prompt();
          }
        }, 2000);

        iface.prompt();
        iface.on("line", (line: string) => {
          attachMux.send(sessionId, line);
          iface.prompt();
        });
        iface.on("close", () => {
          clearInterval(pollTimer);
          console.log("\n\x1b[2mDetached.\x1b[0m\n");
        });

        await new Promise<void>((resolve) => iface.on("close", resolve));
      } else if (attachBackend === "tmux") {
        // Find session name from ID (agent state file)
        const stateFile = resolve(process.cwd(), ".claude", "agents", `${sessionId}.json`);
        const sessionName = existsSync(stateFile)
          ? JSON.parse(readFileSync(stateFile, "utf8")).name ?? sessionId
          : sessionId;

        console.log(`\x1b[36mAttaching to tmux session: ${sessionName}\x1b[0m`);
        console.log(`\x1b[2mDetach: Ctrl+B D\x1b[0m\n`);
        spawnSync("tmux", ["attach", "-t", sessionName], { stdio: "inherit" });
      } else {
        // psmux
        const stateFile = resolve(process.cwd(), ".claude", "agents", `${sessionId}.json`);
        const sessionName = existsSync(stateFile)
          ? JSON.parse(readFileSync(stateFile, "utf8")).name ?? sessionId
          : sessionId;

        console.log(`\x1b[36mAttaching to psmux session: ${sessionName}\x1b[0m`);
        spawnSync("psmux", ["attach", sessionName], { stdio: "inherit", windowsHide: true });
      }
      break;
    }

    case "cleanup": {
      const backend = await ensureMuxBackend();
      const mux = new ProcessMux(backend);
      const count = mux.active();
      await mux.cleanup();
      console.log(`\x1b[32m✓\x1b[0m Cleaned up ${count} session(s).\n`);
      break;
    }

    default:
      console.error(`  Unknown subcommand: ${subcommand}\n`);
      showHelp();
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
\x1b[36mquorum agent\x1b[0m — manage agent processes

\x1b[1mUsage:\x1b[0m quorum agent <subcommand> [options]

\x1b[1mSubcommands:\x1b[0m
  spawn <name> <cmd> [args]   Spawn an agent process
  attach <id>                 Interactive terminal relay to a session
  send <id> <message>         Send input to a running agent
  list                        List active sessions
  capture <id> [--tail N]     Capture output from a session
  kill <id>                   Kill a session
  cleanup                     Kill all sessions

\x1b[1mExamples:\x1b[0m
  quorum agent spawn impl-1 claude -p "implement track TN-1"
  quorum agent attach impl-1                    Interactive relay
  quorum agent send impl-1 "/quorum:verify"
  quorum agent capture impl-1
  quorum agent kill impl-1
`);
}
