/**
 * AgentChatPanel — multi-pane mux session manager in daemon TUI.
 *
 * Layout:
 * ┌─Sessions──┬─Pane 1 (focused)─────┬─Pane 2 (pinned)──┐
 * │ > advocate│ output...             │ output...         │
 * │   devil   │                       │                   │
 * │   judge   │                       │                   │
 * │           │───────────────────────│                   │
 * │ ↑↓ select│ > input here_         │                   │
 * │ p=pin    │                       │                   │
 * └──────────┴───────────────────────┴───────────────────┘
 *
 * Keys:
 *   ↑↓   Select session
 *   i    Enter input mode (type message)
 *   Enter Send message
 *   Esc   Exit input mode
 *   p    Pin/unpin selected session (shows in split pane)
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, readFileSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import type { ProcessMux, MuxSession } from "../../bus/mux.js";
import type { ParliamentLiveSession } from "../state-reader.js";

interface Props {
  mux: ProcessMux;
  liveSessions: ParliamentLiveSession[];
}

/**
 * Parse stream-json NDJSON output into human-readable lines.
 * Extracts assistant text from content_block_delta / result events.
 */
function parseStreamJson(rawLines: string[]): string[] {
  const messageParts: string[] = [];
  let lastRole: "assistant" | "user" | null = null;

  // capture-pane pads lines with spaces — trimEnd before joining to fix wrapped JSON
  const joined = rawLines.map(l => l.trimEnd()).join("");
  // Split on both {"type": and {"role": to catch user message objects
  const entries = joined.split(/(?=\{"(?:type|role)":)/);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed);

      // User message: {"type":"message","role":"user",...} or {"role":"user","content":...}
      if ((obj.type === "message" && obj.role === "user") || (obj.role === "user" && obj.content)) {
        if (lastRole !== "user") {
          messageParts.push("\n───");
        }
        lastRole = "user";
        const content = typeof obj.content === "string"
          ? obj.content
          : Array.isArray(obj.content)
            ? obj.content.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text : "").join("")
            : "";
        if (content) {
          messageParts.push(`[USER] ${content}`);
        }
        continue;
      }

      // Claude stream-json: content_block_delta with text (assistant)
      if (obj.type === "content_block_delta" && obj.delta?.text) {
        if (lastRole !== "assistant") {
          messageParts.push("\n───");
          lastRole = "assistant";
        }
        messageParts.push(obj.delta.text);
        continue;
      }

      // Claude stream-json: result with final text (assistant)
      if (obj.type === "result" && obj.result) {
        if (lastRole !== "assistant") {
          messageParts.push("\n───");
          lastRole = "assistant";
        }
        messageParts.push(obj.result);
        continue;
      }

      // Skip tool_use, tool_result, and other NDJSON noise
    } catch { /* not JSON, show raw */ }
  }

  if (messageParts.length === 0) return rawLines;  // fallback: show raw

  // Join text parts and re-split into display lines
  const fullText = messageParts.join("");
  return fullText.split("\n").filter(Boolean).slice(-40);
}

export function AgentChatPanel({ mux, liveSessions }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [outputs, setOutputs] = useState<Map<string, string[]>>(new Map());
  const [inputBuffer, setInputBuffer] = useState("");
  const [inputMode, setInputMode] = useState(false);

  // Register external sessions in effect (not render body)
  useEffect(() => {
    for (const ls of liveSessions) {
      mux.registerExternal({
        id: ls.id,
        name: ls.name,
        backend: ls.backend as import("../../bus/mux.js").MuxBackend,
        startedAt: ls.startedAt,
        status: "running",
      });
    }
  }, [liveSessions.map(ls => ls.id).join()]);

  const sessions = mux.list().filter(s => s.status === "running");

  // Build outputFile lookup from liveSessions
  const outputFileMap = new Map<string, string>();
  for (const ls of liveSessions) {
    if (ls.outputFile) outputFileMap.set(ls.id, ls.outputFile);
  }

  // Poll ALL sessions — prefer output file over capture-pane
  useEffect(() => {
    if (sessions.length === 0) return;

    const poll = () => {
      const next = new Map(outputs);
      for (const s of sessions) {
        let raw = "";

        // 1. Try output file first (reliable) — read tail only for performance
        const outFile = outputFileMap.get(s.id);
        if (outFile && existsSync(outFile)) {
          try {
            const fd = openSync(outFile, "r");
            const stat = fstatSync(fd);
            const TAIL_BYTES = 32_768; // 32KB tail — enough for recent output
            const start = Math.max(0, stat.size - TAIL_BYTES);
            const buf = Buffer.alloc(Math.min(TAIL_BYTES, stat.size));
            readSync(fd, buf, 0, buf.length, start);
            closeSync(fd);
            raw = buf.toString("utf8");
          } catch { /* ok */ }
        }

        // 2. Fall back to capture-pane
        if (!raw) {
          const cap = mux.capture(s.id, 80);
          if (cap?.output) raw = cap.output;
        }

        if (raw) {
          const rawLines = raw.split("\n").filter(Boolean);
          const hasJson = rawLines.some(l => l.trim().startsWith("{"));
          next.set(s.id, hasJson ? parseStreamJson(rawLines) : rawLines.slice(-40));
        }
      }
      setOutputs(next);
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [sessions.length, sessions.map(s => s.id).join()]);

  useInput(useCallback((input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean }) => {
    if (inputMode) {
      if (key.return) {
        if (inputBuffer.trim() && sessions[selectedIdx]) {
          mux.send(sessions[selectedIdx]!.id, inputBuffer.trim());
          setInputBuffer("");
        }
        setInputMode(false);
      } else if (key.escape) {
        setInputBuffer("");
        setInputMode(false);
      } else if (key.backspace || key.delete) {
        setInputBuffer(prev => prev.slice(0, -1));
      } else if (input && !key.upArrow && !key.downArrow) {
        setInputBuffer(prev => prev + input);
      }
    } else {
      if (key.upArrow) setSelectedIdx(prev => Math.max(0, prev - 1));
      else if (key.downArrow) setSelectedIdx(prev => Math.min(sessions.length - 1, prev + 1));
      else if (input === "i" || key.return) setInputMode(true);
      else if (input === "p" && sessions[Math.min(selectedIdx, sessions.length - 1)]) {
        const id = sessions[Math.min(selectedIdx, sessions.length - 1)]!.id;
        setPinnedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      }
    }
  }, [inputMode, inputBuffer, selectedIdx, sessions.length]));

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Agent Chat</Text>
        <Text dimColor>No active mux sessions.</Text>
        <Text dimColor>quorum orchestrate run &lt;track&gt; or quorum agent spawn &lt;name&gt; claude</Text>
      </Box>
    );
  }

  const safeIdx = Math.min(selectedIdx, sessions.length - 1);
  const selected = sessions[safeIdx];
  if (!selected) return null;
  const pinnedSessions = sessions.filter(s => pinnedIds.has(s.id) && s.id !== selected.id);

  return (
    <Box flexDirection="row" padding={0}>
      {/* Col 1: Session list */}
      <Box flexDirection="column" width={24} borderStyle="single" paddingX={1}>
        <Text bold>Sessions</Text>
        <Text dimColor>{"─".repeat(20)}</Text>
        {sessions.map((s, i) => {
          const isSel = i === selectedIdx;
          const isPinned = pinnedIds.has(s.id);
          const age = Math.round((Date.now() - s.startedAt) / 1000);
          const live = liveSessions.find(ls => ls.id === s.id);
          const role = live?.role ?? s.name.split("-").slice(-2, -1)[0] ?? "agent";
          const color = role === "advocate" ? "green" : role === "devil" ? "red" : role === "judge" ? "blue" : "white";

          return (
            <Text key={s.id} color={isSel ? "cyan" : undefined} bold={isSel}>
              {isSel ? ">" : " "}{isPinned ? "*" : " "}
              <Text color={color}>{role.slice(0, 8).padEnd(8)}</Text>
              <Text dimColor>{age}s</Text>
            </Text>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>↑↓ sel p=pin i=msg</Text>
        </Box>
      </Box>

      {/* Col 2: Focused session */}
      <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
        <SessionPane
          session={selected!}
          lines={outputs.get(selected?.id ?? "") ?? []}
          inputMode={inputMode}
          inputBuffer={inputBuffer}
          focused
        />
      </Box>

      {/* Col 3+: Pinned sessions */}
      {pinnedSessions.map(s => (
        <Box key={s.id} flexDirection="column" width={35} borderStyle="single" paddingX={1}>
          <SessionPane
            session={s}
            lines={outputs.get(s.id) ?? []}
            inputMode={false}
            inputBuffer=""
            focused={false}
          />
        </Box>
      ))}
    </Box>
  );
}

// ── Session Pane (reusable) ─────────────────

function SessionPane({ session, lines, inputMode, inputBuffer, focused }: {
  session: MuxSession;
  lines: string[];
  inputMode: boolean;
  inputBuffer: string;
  focused: boolean;
}) {
  const name = session.name.length > 30 ? session.name.slice(0, 30) + "..." : session.name;

  return (
    <>
      <Text bold color={focused ? "cyan" : undefined}>
        {name} <Text dimColor>{session.backend}</Text>
      </Text>
      <Text dimColor>{"─".repeat(Math.min(name.length + 10, 40))}</Text>

      {/* Output */}
      <Box flexDirection="column" flexGrow={1}>
        {lines.length === 0 ? (
          <Text dimColor>...</Text>
        ) : (
          lines.map((line, i) => (
            <Text key={i} wrap="truncate-end">{line}</Text>
          ))
        )}
      </Box>

      {/* Input (focused pane only) */}
      {focused && (
        <>
          <Text dimColor>{"─".repeat(Math.min(name.length + 10, 40))}</Text>
          {inputMode ? (
            <Box>
              <Text color="cyan" bold>{">"} </Text>
              <Text>{inputBuffer}<Text color="cyan">_</Text></Text>
            </Box>
          ) : (
            <Text dimColor>[p] pin/unpin  msg: quorum tool agent_comm</Text>
          )}
        </>
      )}
    </>
  );
}
