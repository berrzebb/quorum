/* global process, console, Buffer */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBinary, spawnResolvedAsync } from "../cli-runner.mjs";
import { HOOKS_DIR, REPO_ROOT, cfg, t } from "../context.mjs";
import { readSavedSession, deleteSavedSessionId } from "./session.mjs";

const codexLogPath = resolve(HOOKS_DIR, "codex-session.log");

export function resolveCodexBin() {
  return resolveBinary("codex", "CODEX_BIN");
}

export function determineResumeTarget(args, auditStatusPath) {
  if (args.resume === false) {
    return null;
  }

  if (args.sessionId) {
    return { type: "session", value: args.sessionId };
  }

  const saved = readSavedSession();
  if (saved) {
    // If audit-status.json shows pending → reset session to prevent orphan call buildup on resume
    if (existsSync(auditStatusPath)) {
      try {
        const status = JSON.parse(readFileSync(auditStatusPath, "utf8"));
        if (status.pendingCount > 0) {
          deleteSavedSessionId();
          console.log(t("audit.session.reset_pending"));
          return null;
        }
      } catch (err) { console.warn("[codex-runner] audit-status read failed:", err?.message ?? err); }
    }
    return { type: "session", value: saved };
  }

  if (args.resumeLast) {
    return { type: "last", value: null };
  }

  return null;
}

export function buildCodexArgs(args, resumeTarget, cwd) {
  const wantsFullAccess = args.sandbox === "danger-full-access";

  if (resumeTarget) {
    const base = ["exec", "resume"];

    if (args.model) {
      base.push("--model", args.model);
    }
    if (wantsFullAccess) {
      base.push("--dangerously-bypass-approvals-and-sandbox");
    }
    base.push("--json");

    if (resumeTarget.type === "last") {
      base.push("--last");
    } else {
      base.push(resumeTarget.value);
    }

    base.push("-");
    return base;
  }

  const base = [
    "exec",
    "-C",
    cwd || REPO_ROOT,
  ];

  if (wantsFullAccess) {
    base.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    base.push("--sandbox", args.sandbox);
  }

  if (args.model) {
    base.push("--model", args.model);
  }
  base.push("--json");

  base.push("-");
  return base;
}

/** Line-by-line real-time streaming — print agent_message immediately, track threadId + verdictText. */
export function streamCodexOutput(child, rawJson) {
  return new Promise((resolvePromise, reject) => {
    let threadId = null;
    let stdoutForLog = "";
    const stderrChunks = [];
    let buffer = "";
    const verdictParts = [];

    function processLine(line) {
      if (!line) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          threadId = event.thread_id;
        }
        if (rawJson) {
          console.log(line);
        } else if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
          verdictParts.push(event.item.text);
          console.log(event.item.text);
        }
      } catch (err) {
        console.warn("[codex-runner] JSON parse failed:", err?.message ?? err);
        console.log(line);
      }
    }

    child.stdout.on("data", (chunk) => {
      const str = chunk.toString("utf8");
      if (stdoutForLog.length < 5000) stdoutForLog += str;
      buffer += str;
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        processLine(buffer.slice(0, idx).trim());
        buffer = buffer.slice(idx + 1);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer.trim());

      const stdout = stdoutForLog;
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      // Write debug log to codex-session.log
      try {
        const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
        appendFileSync(codexLogPath, `\n=== [${ts}] Codex session output ===\n`);
        if (stdout) appendFileSync(codexLogPath, `[stdout]\n${stdout.slice(0, 5000)}\n`);
        if (stderr) appendFileSync(codexLogPath, `[stderr]\n${stderr.slice(0, 2000)}\n`);
      } catch (err) { console.warn("[codex-runner] log write failed:", err?.message ?? err); }

      resolvePromise({ stdout, stderr, threadId, exitCode: code, verdictText: verdictParts.join("\n") });
    });
  });
}
