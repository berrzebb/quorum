/**
 * AgentChatPanel — scrollable multi-pane mux session manager + git log.
 *
 * Layout (adaptive):
 * ┌─Sessions──┬─Output (scrollable)──────────┬─Git Log──┐
 * │ > impl-1  │ agent output lines...        │ abc1234  │
 * │   impl-2  │ (scroll ↑↓)                  │ def5678  │
 * │   audit   │                               │ ghi9012  │
 * ├───────────┴──────────────────────────────┴──────────┤
 * │ > input here_                                       │
 * └─────────────────────────────────────────────────────┘
 *
 * Keys:
 *   ↑↓       Scroll output
 *   ←→       Switch session
 *   i/Enter  Input mode (type message)
 *   Esc      Exit input mode
 *   p        Pin/unpin (pinned sessions cycle in sidebar)
 *
 * Breakpoints:
 *   < 60 cols  → hide session list
 *   < 100 cols → hide git log
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { execSync } from "node:child_process";
import type { ProcessMux, MuxSession } from "../../platform/bus/mux.js";
import type { ParliamentLiveSession } from "../state-reader.js";
import { ageSeconds } from "../lib/time.js";

interface Props {
  mux: ProcessMux;
  liveSessions: ParliamentLiveSession[];
}

const MAX_BUFFER_LINES = 200;
const SCROLL_STEP = 3;

// ── NDJSON parser ────────────────────────────

function parseStreamJson(rawLines: string[]): string[] {
  const messageParts: string[] = [];
  let lastRole: "assistant" | "user" | null = null;

  const joined = rawLines.map(l => l.trimEnd()).join("");
  const entries = joined.split(/(?=\{"(?:type|role)":)/);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);

      if ((obj.type === "message" && obj.role === "user") || (obj.role === "user" && obj.content)) {
        if (lastRole !== "user") messageParts.push("\n───");
        lastRole = "user";
        const content = typeof obj.content === "string"
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text : "").join("")
            : "";
        if (content) messageParts.push(`[USER] ${content}`);
        continue;
      }

      if (obj.type === "content_block_delta" && obj.delta?.text) {
        if (lastRole !== "assistant") { messageParts.push("\n───"); lastRole = "assistant"; }
        messageParts.push(obj.delta.text);
        continue;
      }

      if (obj.type === "result" && obj.result) {
        if (lastRole !== "assistant") { messageParts.push("\n───"); lastRole = "assistant"; }
        messageParts.push(obj.result);
        continue;
      }
    } catch (err) { console.warn(`[agent-chat] JSON parse failed: ${(err as Error).message}`); }
  }

  if (messageParts.length === 0) return rawLines;
  return messageParts.join("").split("\n").filter(Boolean).slice(-MAX_BUFFER_LINES);
}

// ── Main Component ───────────────────────────

export function AgentChatPanel({ mux, liveSessions }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [outputs, setOutputs] = useState<Map<string, string[]>>(new Map());
  const [inputBuffer, setInputBuffer] = useState("");
  const [inputMode, setInputMode] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [gitLog, setGitLog] = useState<string[]>([]);
  const [termSize, setTermSize] = useState({ rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 });

  // Track terminal resize
  useEffect(() => {
    const onResize = () => setTermSize({ rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 });
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  // Layout breakpoints
  const showSessionList = termSize.cols >= 60;
  const showGitLog = termSize.cols >= 100;
  const sessionListWidth = showSessionList ? 22 : 0;
  const gitLogWidth = showGitLog ? Math.min(35, Math.floor(termSize.cols * 0.25)) : 0;
  // Header(1) + separator(1) + bottom input(3) + borders(2) = 7
  const visibleLines = Math.max(termSize.rows - 7, 5);

  // Register external sessions
  useEffect(() => {
    for (const ls of liveSessions) {
      mux.registerExternal({
        id: ls.id,
        name: ls.name,
        backend: ls.backend as import("../../platform/bus/mux.js").MuxBackend,
        startedAt: ls.startedAt,
        status: "running",
      });
    }
  }, [liveSessions.map(ls => ls.id).join()]);

  const sessions = mux.list().filter(s => s.status === "running");

  // Output file map
  const outputFileMap = new Map<string, string>();
  for (const ls of liveSessions) {
    if (ls.outputFile) outputFileMap.set(ls.id, ls.outputFile);
  }

  // Poll session outputs
  useEffect(() => {
    if (sessions.length === 0) return;
    const poll = () => {
      const next = new Map(outputs);
      for (const s of sessions) {
        let raw = "";
        const outFile = outputFileMap.get(s.id);
        if (outFile && existsSync(outFile)) {
          try {
            const fd = openSync(outFile, "r");
            const stat = fstatSync(fd);
            const TAIL = 65_536; // 64KB for more scroll content
            const start = Math.max(0, stat.size - TAIL);
            const buf = Buffer.alloc(Math.min(TAIL, stat.size));
            readSync(fd, buf, 0, buf.length, start);
            closeSync(fd);
            raw = buf.toString("utf8");
          } catch (err) { console.warn(`[agent-chat] output file read failed: ${(err as Error).message}`); }
        }
        if (!raw) {
          const cap = mux.capture(s.id, 120);
          if (cap?.output) raw = cap.output;
        }
        if (raw) {
          const rawLines = raw.split("\n").filter(Boolean);
          const hasJson = rawLines.some(l => l.trim().startsWith("{"));
          next.set(s.id, hasJson ? parseStreamJson(rawLines) : rawLines.slice(-MAX_BUFFER_LINES));
        }
      }
      setOutputs(next);
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [sessions.length, sessions.map(s => s.id).join()]);

  // Poll git log
  useEffect(() => {
    if (!showGitLog) return;
    const pollGit = () => {
      try {
        const log = execSync("git log --oneline -30", {
          encoding: "utf8", timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
        }).trim();
        setGitLog(log ? log.split("\n") : []);
      } catch (err) { console.warn(`[AgentChatPanel] git log failed: ${(err as Error).message}`); setGitLog(["(no git repo)"]); }
    };
    pollGit();
    const timer = setInterval(pollGit, 5000);
    return () => clearInterval(timer);
  }, [showGitLog]);

  // Current session + lines
  const safeIdx = Math.min(selectedIdx, Math.max(0, sessions.length - 1));
  const selected = sessions[safeIdx];
  const lines = outputs.get(selected?.id ?? "") ?? [];
  const maxScroll = Math.max(0, lines.length - visibleLines);

  // Auto-scroll to bottom when new content arrives (if already at bottom)
  useEffect(() => {
    if (scrollOffset === 0) { /* already at bottom — stays at bottom */ }
  }, [lines.length]);

  // Compute visible slice
  const safeOffset = Math.min(scrollOffset, maxScroll);
  const startIdx = Math.max(0, lines.length - visibleLines - safeOffset);
  const displayLines = lines.slice(startIdx, startIdx + visibleLines);

  // Key handling
  useInput(useCallback((input: string, key: {
    upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean;
    return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean;
  }) => {
    if (inputMode) {
      if (key.return) {
        if (inputBuffer.trim() && selected) {
          mux.send(selected.id, inputBuffer.trim());
          setInputBuffer("");
        }
        setInputMode(false);
      } else if (key.escape) {
        setInputBuffer("");
        setInputMode(false);
      } else if (key.backspace || key.delete) {
        setInputBuffer(prev => prev.slice(0, -1));
      } else if (input && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) {
        setInputBuffer(prev => prev + input);
      }
    } else {
      // ↑↓ = scroll output
      if (key.upArrow) setScrollOffset(prev => Math.min(prev + SCROLL_STEP, maxScroll));
      else if (key.downArrow) setScrollOffset(prev => Math.max(0, prev - SCROLL_STEP));
      // ←→ = switch session
      else if (key.leftArrow) {
        setSelectedIdx(prev => Math.max(0, prev - 1));
        setScrollOffset(0);
      } else if (key.rightArrow) {
        setSelectedIdx(prev => Math.min(sessions.length - 1, prev + 1));
        setScrollOffset(0);
      }
      // i/Enter = input mode
      else if (input === "i" || key.return) setInputMode(true);
    }
  }, [inputMode, inputBuffer, selectedIdx, sessions.length, maxScroll]));

  // ── Empty state ─────────────────────────────

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Agent Chat</Text>
        <Text dimColor>No active mux sessions.</Text>
        <Text dimColor>quorum orchestrate run &lt;track&gt; or quorum agent spawn &lt;name&gt; claude</Text>
      </Box>
    );
  }

  // ── Render ──────────────────────────────────

  const live = liveSessions.find(ls => ls.id === selected?.id);
  const selectedRole = live?.role ?? selected?.name.split("-").slice(-2, -1)[0] ?? "agent";
  const scrollPct = lines.length > visibleLines
    ? Math.round(((lines.length - safeOffset - visibleLines) / (lines.length - visibleLines)) * 100)
    : 100;

  return (
    <Box flexDirection="column">
      {/* ── Top: main panels ─────────────── */}
      <Box flexDirection="row">

        {/* Col 1: Session list */}
        {showSessionList && (
          <Box flexDirection="column" width={sessionListWidth} borderStyle="single" paddingX={1}>
            <Text bold>Sessions</Text>
            <Text dimColor>{"─".repeat(18)}</Text>
            {sessions.map((s, i) => {
              const isSel = i === safeIdx;
              const age = ageSeconds(s.startedAt);
              const liveInfo = liveSessions.find(ls => ls.id === s.id);
              const role = liveInfo?.role ?? s.name.split("-").slice(-2, -1)[0] ?? "agent";
              const color = role === "advocate" ? "green"
                : role === "devil" ? "red"
                : role === "judge" ? "blue"
                : role === "implementer" || role === "impl" ? "yellow"
                : "white";
              return (
                <Text key={s.id} color={isSel ? "cyan" : undefined} bold={isSel}>
                  {isSel ? ">" : " "} <Text color={color}>{role.slice(0, 10).padEnd(10)}</Text>
                  <Text dimColor>{age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`}</Text>
                </Text>
              );
            })}
          </Box>
        )}

        {/* Col 2: Output pane (scrollable) */}
        <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
          {/* Header */}
          <Box justifyContent="space-between">
            <Text bold color="cyan">
              {selectedRole} <Text dimColor>{selected?.backend ?? ""}</Text>
            </Text>
            <Text dimColor>
              {safeOffset > 0 ? `▲${safeOffset}` : ""} {lines.length}L {scrollPct}%
            </Text>
          </Box>
          <Text dimColor>{"─".repeat(40)}</Text>

          {/* Scrollable output */}
          <Box flexDirection="column" height={visibleLines}>
            {displayLines.length === 0 ? (
              <Text dimColor>waiting for output...</Text>
            ) : (
              displayLines.map((line, i) => (
                <Text key={startIdx + i} wrap="truncate-end">{line}</Text>
              ))
            )}
          </Box>

          {/* Scroll indicator bar */}
          {lines.length > visibleLines && (
            <Text dimColor>
              {safeOffset > 0 ? "▲ " : "  "}
              {"─".repeat(20)}
              {startIdx > 0 ? " ▼" : "  "}
            </Text>
          )}
        </Box>

        {/* Col 3: Git log */}
        {showGitLog && (
          <Box flexDirection="column" width={gitLogWidth} borderStyle="single" paddingX={1}>
            <Text bold>Git Log</Text>
            <Text dimColor>{"─".repeat(Math.max(0, gitLogWidth - 4))}</Text>
            {gitLog.slice(0, visibleLines).map((line, i) => {
              const isWIP = line.includes("WIP(");
              return (
                <Text key={i} wrap="truncate-end" color={isWIP ? "green" : undefined} dimColor={!isWIP}>
                  {line}
                </Text>
              );
            })}
            {gitLog.length === 0 && <Text dimColor>no commits</Text>}
          </Box>
        )}
      </Box>

      {/* ── Bottom: input area ─────────── */}
      <Box borderStyle="single" paddingX={1} height={3}>
        {inputMode ? (
          <Box flexGrow={1}>
            <Text color="cyan" bold>{">"} </Text>
            <Text>{inputBuffer}<Text color="cyan" inverse> </Text></Text>
          </Box>
        ) : (
          <Box justifyContent="space-between" flexGrow={1}>
            <Text dimColor>
              [←→] session  [↑↓] scroll  [i] input  [Enter] send
            </Text>
            <Text dimColor>
              {sessions.length} active
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
