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
import type { ProcessMux, MuxSession } from "../../bus/mux.js";
import type { ParliamentLiveSession } from "../state-reader.js";

interface Props {
  mux: ProcessMux;
  liveSessions: ParliamentLiveSession[];
}

export function AgentChatPanel({ mux, liveSessions }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [outputs, setOutputs] = useState<Map<string, string[]>>(new Map());
  const [inputBuffer, setInputBuffer] = useState("");
  const [inputMode, setInputMode] = useState(false);

  const sessions = mux.list().filter(s => s.status === "running");

  // Poll all visible sessions (selected + pinned)
  useEffect(() => {
    if (sessions.length === 0) return;

    const poll = () => {
      const visibleIds = new Set<string>();
      if (sessions[selectedIdx]) visibleIds.add(sessions[selectedIdx]!.id);
      for (const id of pinnedIds) visibleIds.add(id);

      const next = new Map(outputs);
      for (const id of visibleIds) {
        const cap = mux.capture(id, 20);
        if (cap?.output) {
          next.set(id, cap.output.split("\n").filter(Boolean).slice(-20));
        }
      }
      setOutputs(next);
    };

    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [selectedIdx, pinnedIds.size, sessions.length]);

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
      else if (input === "p" && sessions[selectedIdx]) {
        const id = sessions[selectedIdx]!.id;
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

  const selected = sessions[selectedIdx];
  const pinnedSessions = sessions.filter(s => pinnedIds.has(s.id) && s.id !== selected?.id);

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
            <Text dimColor>[i] type  [Enter] send  [p] pin/unpin</Text>
          )}
        </>
      )}
    </>
  );
}
