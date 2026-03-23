/* global process, console, Buffer */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBinary, spawnResolvedAsync } from "../cli-runner.mjs";
import { HOOKS_DIR, REPO_ROOT, cfg, t } from "../context.mjs";
import { hasPendingItems } from "./scope.mjs";
import { readSavedSession, deleteSavedSessionId } from "./session.mjs";

const codexLogPath = resolve(HOOKS_DIR, "codex-session.log");

export function resolveCodexBin() {
  return resolveBinary("codex", "CODEX_BIN");
}

export function determineResumeTarget(args, gptPath) {
  if (args.resume === false) {
    return null;
  }

  if (args.sessionId) {
    return { type: "session", value: args.sessionId };
  }

  const saved = readSavedSession();
  if (saved) {
    // gpt.md에 [계류] 항목이 있으면 세션 리셋 — 재개 시 orphan call 누적 방지
    if (existsSync(gptPath)) {
      try {
        const gptMd = readFileSync(gptPath, "utf8");
        if (hasPendingItems(gptMd)) {
          deleteSavedSessionId();
          console.log(t("audit.session.reset_pending"));
          return null;
        }
      } catch { /* 파일 읽기 실패 시 기존 세션 유지 */ }
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

/** 라인 단위 실시간 스트리밍 — agent_message를 즉시 출력하고 threadId를 추적. */
export function streamCodexOutput(child, rawJson) {
  return new Promise((resolvePromise, reject) => {
    let threadId = null;
    const stdoutChunks = [];
    const stderrChunks = [];
    let buffer = "";

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
          console.log(event.item.text);
        }
      } catch {
        console.log(line);
      }
    }

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      buffer += chunk.toString("utf8");
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

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      // codex-session.log에 디버깅용 기록
      try {
        const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
        appendFileSync(codexLogPath, `\n=== [${ts}] Codex session output ===\n`);
        if (stdout) appendFileSync(codexLogPath, `[stdout]\n${stdout.slice(0, 5000)}\n`);
        if (stderr) appendFileSync(codexLogPath, `[stderr]\n${stderr.slice(0, 2000)}\n`);
      } catch { /* ignore logging failures */ }

      resolvePromise({ stdout, stderr, threadId, exitCode: code });
    });
  });
}
