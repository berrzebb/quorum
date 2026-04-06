/**
 * Chat view — mux session transcript control + composer + git context.
 *
 * Absorbs ALL functional logic from AgentChatPanel.tsx:
 * - mux session management, output polling, NDJSON parsing
 * - git log polling, input mode, scroll, session switching
 *
 * Delegates RENDERING to extracted panel components:
 * - SessionList, TranscriptPane, Composer, GitSidebar
 *
 * Falls back to file-based review threads when no mux is available.
 *
 * Layout (adaptive):
 *   Col 1: SessionList (hidden < 60 cols)
 *   Col 2: TranscriptPane (scrollable output)
 *   Col 3: GitSidebar (hidden < 100 cols)
 *   Bottom: Composer
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import type { ProcessMux } from "../../platform/bus/mux.js";
import type { FullState, ParliamentLiveSession, FileThread } from "../state-reader.js";
import { SessionList } from "../panels/sessions/session-list.js";
import type { SessionInfo } from "../panels/sessions/session-list.js";
import { TranscriptPane, parseStreamJson } from "../panels/sessions/transcript-pane.js";
import { Composer } from "../panels/sessions/composer.js";
import { GitExplorer } from "../panels/sessions/git-explorer.js";
import { GitSidebar } from "../panels/sessions/git-sidebar.js";
import { severityColor } from "../lib/format.js";

interface ChatViewProps {
  state: FullState | null;
  mux: ProcessMux | null;
  liveSessions?: ParliamentLiveSession[];
  agentEvents?: import("../../platform/bus/events.js").QuorumEvent[];
  focusedRegion?: string | null;
  width: number;
  height: number;
}

const MAX_BUFFER_LINES = 200;
const SCROLL_STEP = 3;

export function ChatView({ state, mux, liveSessions = [], agentEvents = [], focusedRegion, width, height }: ChatViewProps): React.ReactElement {
  // If no mux, show file-based review threads fallback
  if (!mux) {
    return <ChatFallback fileThreads={state?.fileThreads ?? []} />;
  }

  return <MuxChatView mux={mux} liveSessions={liveSessions} agentEvents={agentEvents} focusedRegion={focusedRegion} width={width} height={height} />;
}

// ── Mux Chat View (full interactive) ────────────────────────────────

function MuxChatView({ mux, liveSessions, agentEvents = [], focusedRegion, width, height }: {
  mux: ProcessMux;
  liveSessions: ParliamentLiveSession[];
  agentEvents?: import("../../platform/bus/events.js").QuorumEvent[];
  focusedRegion?: string | null;
  width: number;
  height: number;
}) {
  const f = (region: string) => focusedRegion === region;
  const isGitFocused = f("chat.git");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [outputs, setOutputs] = useState<Map<string, string[]>>(new Map());
  const [inputBuffer, setInputBuffer] = useState("");
  const [inputMode, setInputMode] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isSticky, setIsSticky] = useState(true); // stickyScroll: auto-follow bottom
  const [gitSelectedIdx, setGitSelectedIdx] = useState(0);
  const [commitDetail, setCommitDetail] = useState<string[]>([]);
  const [termSize, setTermSize] = useState({ rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 });

  // Track terminal resize
  useEffect(() => {
    const onResize = () => setTermSize({ rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 });
    process.stdout.on("resize", onResize);
    return () => { process.stdout.off("resize", onResize); };
  }, []);

  // Layout breakpoints
  const showSessionList = termSize.cols >= 60;
  const showGitLog = termSize.cols >= 80;
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

  // Output file map (parliament + orchestrate agents)
  const outputFileMap = new Map<string, string>();
  for (const ls of liveSessions) {
    if (ls.outputFile) outputFileMap.set(ls.id, ls.outputFile);
  }
  for (const ev of agentEvents) {
    if (ev.type === "agent.spawn" && ev.payload.outputFile && ev.payload.sessionId) {
      outputFileMap.set(ev.payload.sessionId as string, ev.payload.outputFile as string);
    }
  }

  // Poll session outputs (2s interval)
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
          } catch (err) { console.warn(`[chat-view] output file read failed: ${(err as Error).message}`); }
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
      setOutputs(prev => {
        // stickyScroll: reset offset to 0 if content grew and we're sticky
        if (isSticky) {
          const selectedId = sessions[Math.min(selectedIdx, sessions.length - 1)]?.id;
          if (selectedId) {
            const prevLen = prev.get(selectedId)?.length ?? 0;
            const nextLen = next.get(selectedId)?.length ?? 0;
            if (nextLen > prevLen) setScrollOffset(0);
          }
        }
        return next;
      });
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [sessions.length, sessions.map(s => s.id).join(), isSticky]);

  // Git polling handled by GitExplorer component

  // Current session + lines
  const safeIdx = Math.min(selectedIdx, Math.max(0, sessions.length - 1));
  const selected = sessions[safeIdx];
  const lines = outputs.get(selected?.id ?? "") ?? [];
  const maxScroll = Math.max(0, lines.length - visibleLines);

  // Key handling
  useInput(useCallback((input: string, key: {
    upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean;
    return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean;
    tab?: boolean; shift?: boolean;
  }) => {
    // Skip view-level shortcuts when in chat (tab, shift+tab, 1-4 keys)
    // These are handled by the parent app shell

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
    } else if (isGitFocused) {
      // Git navigation: ↑↓ moves commit selection
      if (key.upArrow) setGitSelectedIdx(prev => Math.max(0, prev - 1));
      else if (key.downArrow) setGitSelectedIdx(prev => prev + 1);
    } else {
      // Agent chat navigation
      if (key.upArrow) {
        setScrollOffset(prev => Math.min(prev + SCROLL_STEP, maxScroll));
        setIsSticky(false); // Break sticky on scroll up
      } else if (key.downArrow) {
        setScrollOffset(prev => {
          const next = Math.max(0, prev - SCROLL_STEP);
          if (next === 0) setIsSticky(true); // Re-engage sticky at bottom
          return next;
        });
      }
      else if (key.leftArrow) {
        setSelectedIdx(prev => Math.max(0, prev - 1));
        setScrollOffset(0);
      } else if (key.rightArrow) {
        setSelectedIdx(prev => Math.min(sessions.length - 1, prev + 1));
        setScrollOffset(0);
      }
      else if (input === "i" || key.return) setInputMode(true);
    }
  }, [inputMode, inputBuffer, selectedIdx, sessions.length, maxScroll, isGitFocused]));

  // Empty state — still show git explorer
  if (sessions.length === 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="single" paddingX={1} height={Math.floor(visibleLines * 0.4)}>
          <Text bold>Agent Chat</Text>
          <Text dimColor>No active mux sessions.</Text>
          <Text dimColor>quorum orchestrate run &lt;track&gt; or quorum agent spawn &lt;name&gt; claude</Text>
        </Box>
        <GitExplorer
          focused={isGitFocused}
          height={Math.floor(visibleLines * 0.6)}
          selectedIdx={gitSelectedIdx}
          onSelectedIdxChange={setGitSelectedIdx}
          onCommitSelect={setCommitDetail}
        />
      </Box>
    );
  }

  // Build session info for SessionList
  const sessionInfos: SessionInfo[] = sessions.map(s => {
    const liveInfo = liveSessions.find(ls => ls.id === s.id);
    return {
      id: s.id,
      name: s.name,
      backend: s.backend,
      startedAt: s.startedAt,
      role: liveInfo?.role ?? s.name.split("-").slice(-2, -1)[0] ?? "agent",
    };
  });

  const live = liveSessions.find(ls => ls.id === selected?.id);
  const selectedRole = live?.role ?? selected?.name.split("-").slice(-2, -1)[0] ?? "agent";

  // Split visible height: top 60%, bottom 40%
  const topHeight = Math.max(Math.floor(visibleLines * 0.6), 5);
  const bottomHeight = Math.max(visibleLines - topHeight, 5);

  // When git is focused and commit is selected, show detail in transcript area
  const displayLines = isGitFocused && commitDetail.length > 0 ? commitDetail : lines;
  const displayRole = isGitFocused && commitDetail.length > 0 ? "commit" : selectedRole;
  const displayBackend = isGitFocused && commitDetail.length > 0 ? "git" : selected?.backend;

  return (
    <Box flexDirection="column">
      {/* Row 1: Sessions + Agent Chat / Commit Detail */}
      <Box flexDirection="row">
        {showSessionList && (
          <SessionList
            sessions={sessionInfos}
            selectedIdx={safeIdx}
            onSelect={setSelectedIdx}
            width={sessionListWidth}
            focused={f("chat.sessions")}
          />
        )}
        <TranscriptPane
          lines={displayLines}
          scrollOffset={isGitFocused ? 0 : scrollOffset}
          height={topHeight}
          sessionId={selected?.id ?? ""}
          role={displayRole}
          backend={displayBackend}
          focused={f("chat.transcript")}
        />
      </Box>

      {/* Row 2: Git Explorer */}
      <GitExplorer
        focused={isGitFocused}
        height={bottomHeight}
        selectedIdx={gitSelectedIdx}
        onSelectedIdxChange={setGitSelectedIdx}
        onCommitSelect={setCommitDetail}
      />

      {/* Bottom: composer */}
      <Composer
        buffer={inputBuffer}
        mode={inputMode ? "input" : "idle"}
        onSubmit={(text) => {
          if (text.trim() && selected) {
            mux.send(selected.id, text.trim());
          }
        }}
        onBufferChange={setInputBuffer}
        sessionId={selected?.id ?? ""}
        sessionCount={sessions.length}
        focused={f("chat.composer")}
      />
    </Box>
  );
}

// ── Fallback: file-based review threads (no mux) ────────────────────

function msgTypeIcon(type: string): string {
  switch (type) {
    case "finding": return "●";
    case "reply": return "↳";
    case "ack": return "✓";
    case "resolve": return "✔";
    default: return "·";
  }
}

function msgColor(type: string, description?: string): string {
  switch (type) {
    case "finding": return "white";
    case "reply": return "cyan";
    case "ack": return description?.startsWith("fix") ? "green" : "yellow";
    case "resolve": return "green";
    default: return "gray";
  }
}

function ChatFallback({ fileThreads }: { fileThreads: FileThread[] }) {
  const hasThreads = fileThreads.some(ft => ft.threads.length > 0);
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Review Threads</Text>
      <Text dimColor>{"─".repeat(70)}</Text>
      {!hasThreads ? (
        <Text dimColor>No review threads yet</Text>
      ) : (
        fileThreads.map((ft) => (
          <Box key={ft.file} flexDirection="column" marginBottom={1}>
            <Text color="blue" bold>{ft.file}</Text>
            {ft.threads.map((thread) => (
              <Box key={thread.rootId} flexDirection="column" marginLeft={1}>
                {thread.messages.slice(0, 12).map((msg, i) => {
                  const indent = msg.type === "reply" || msg.type === "ack" || msg.type === "resolve" ? 2 : 0;
                  const desc = msg.description.length > 55
                    ? msg.description.slice(0, 55) + "..."
                    : msg.description;
                  const time = new Date(msg.timestamp).toLocaleTimeString("en-GB", {
                    hour: "2-digit", minute: "2-digit",
                  });
                  return (
                    <Text key={`${thread.rootId}-${i}`}>
                      {" ".repeat(indent)}
                      <Text color={msgColor(msg.type, msg.description)}>
                        {msgTypeIcon(msg.type)}
                      </Text>
                      {" "}
                      <Text dimColor>[{time}]</Text>
                      {" "}
                      <Text bold color="cyan">{msg.reviewerId}</Text>
                      {msg.severity && (
                        <Text color={severityColor(msg.severity)}> {msg.severity}</Text>
                      )}
                      {" "}
                      <Text>{desc}</Text>
                    </Text>
                  );
                })}
                {thread.messages.length > 12 && (
                  <Text dimColor>  ...{thread.messages.length - 12} more messages</Text>
                )}
                {!thread.open && (
                  <Text dimColor color="green">  [resolved]</Text>
                )}
              </Box>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}
