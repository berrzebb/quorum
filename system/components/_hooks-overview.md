# Hooks Overview

> 26 unique hook events across 4 adapters (v0.4.5)
>
> **v0.3.0**: 5 core events (SessionStart, PreToolUse, PostToolUse, Stop, UserPromptSubmit)
> **v0.4.0**: SubagentStart/Stop, TaskCompleted, WorktreeCreate/Remove
> **v0.4.2**: Elicitation, ConfigChange, PermissionRequest, Notification
> **v0.4.5**: 4-adapter parity — Claude Code 21, Gemini 11, Codex 6

## What are Hooks?

Hooks are **scripts that execute on specific Claude Code events**.
- Defined in `hooks/hooks.json` per adapter
- Run Node.js scripts that output JSON (`allow`/`block` decisions)
- Fail-open: all hooks pass through on error (no system lockout)

## Hook Architecture

```
┌─ Hook Sources ───────────────────────────────────────────┐
│                                                          │
│  hooks/hooks.json (adapter-level)                        │
│  ├── SessionStart, UserPromptSubmit, PreCompact, ...     │
│  │                                                       │
│  SKILL.md frontmatter hooks                              │
│  ├── PreToolUse, PostToolUse, Stop per skill             │
│  │                                                       │
│  AGENT.md frontmatter hooks                              │
│  └── SubagentStart, SubagentStop per agent               │
│                                                          │
└──────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Hook Engine ────────────────────────────────────────────┐
│  platform/adapters/shared/hook-runner.mjs                 │
│  ├── command/http handlers                               │
│  ├── env interpolation (${CLAUDE_PLUGIN_ROOT}, etc.)     │
│  ├── deny-first-break (any deny → stop)                  │
│  ├── async fire-and-forget                               │
│  └── matcher filtering                                   │
└──────────────────────────────────────────────────────────┘
```

## Hook Events by Adapter

### Claude Code (21 events)

| Event | Matcher | Script | Purpose |
|-------|---------|--------|---------|
| **SessionStart** | — | session-start.mjs | Config copy, audit state detection, handoff load |
| **UserPromptSubmit** | — | prompt-submit.mjs | Retro enforcement, resume detection |
| **PreToolUse** | `Bash\|Agent` | session-gate.mjs | Retro block, audit lock |
| **PostToolUse** | `Edit\|Write` | index.mjs | Trigger eval, domain routing, specialist tools |
| **PostToolUseFailure** | — | — | Error handling |
| **Stop** | — | stop.mjs | Session cleanup |
| **StopFailure** | — | — | Failure handling |
| **SubagentStart** | `implementer\|scout` | subagent-start.mjs | Agent initialization |
| **SubagentStop** | `implementer` | subagent-stop.mjs | Claim release, results capture |
| **TaskCompleted** | — | task-completed.mjs | Done-criteria verification |
| **WorktreeCreate** | — | — | Worktree initialization |
| **WorktreeRemove** | — | — | Worktree cleanup |
| **PreCompact** | — | — | State snapshot before compaction |
| **PostCompact** | — | — | State restoration after compaction |
| **TeammateIdle** | — | — | Idle detection |
| **InstructionsLoaded** | — | — | Context injection |
| **ConfigChange** | — | — | Config hot-reload |
| **PermissionRequest** | — | — | Permission arbitration |
| **Notification** | — | — | System notifications |
| **Elicitation** | — | — | User input collection |
| **ElicitationResult** | — | — | User input processing |
| **SessionEnd** | — | — | Session teardown |

### Gemini CLI (11 events)

| Event | Purpose |
|-------|---------|
| **SessionStart** | Session initialization |
| **BeforeAgent** | Pre-agent execution |
| **AfterAgent** | Post-agent execution |
| **BeforeModel** | Pre-model call |
| **AfterModel** | Post-model call |
| **BeforeToolSelection** | Tool selection override |
| **BeforeTool** | Pre-tool execution |
| **AfterTool** | Post-tool execution (30s timeout) |
| **PreCompress** | Pre-compaction snapshot |
| **Notification** | System notifications |
| **SessionEnd** | Session teardown |

### Codex (6 events)

| Event | Purpose |
|-------|---------|
| **SessionStart** | Session initialization (`^startup$` matcher) |
| **Stop** | Session cleanup |
| **UserPromptSubmit** | User input preprocessing |
| **AfterAgent** | Post-agent execution |
| **AfterToolUse** | Post-tool execution |

## Core Hook Flow (Claude Code)

```
1. SessionStart (once)
   └─▶ session-start.mjs
       ├── Copy config.json to project if missing
       ├── Read audit-status.json (fast-path detection)
       ├── Detect interrupted audits → resume instructions
       └── Load handoff from memory

2. User types a message
   └─▶ UserPromptSubmit
       └─▶ prompt-submit.mjs
           ├── Check retro enforcement
           └── Detect orchestrator resume intent

3. AI uses a tool (Bash, Agent, Edit, Write)
   ├─▶ PreToolUse [Bash|Agent]
   │   └─▶ session-gate.mjs
   │       ├── Block if retro pending
   │       └── Block if audit lock active
   │
   │   Tool executes...
   │
   └─▶ PostToolUse [Edit|Write]
       └─▶ index.mjs (main hook)
           ├── Trigger evaluation (13-factor scoring)
           ├── Domain detection (zero-cost file patterns)
           ├── Specialist tool injection
           └── Bridge to core/bridge.mjs

4. Subagent lifecycle
   ├─▶ SubagentStart [implementer|scout]
   │   └── Initialize claims, set up context
   └─▶ SubagentStop [implementer]
       └── Release file claims, capture results

5. Task completion
   └─▶ TaskCompleted
       └─▶ task-completed.mjs
           └── Verify done-criteria (CQ/T/CC/CL/S/I/FV/CV)

6. Session ends
   └─▶ Stop
       └─▶ stop.mjs
           └── Cleanup, state persistence
```

## Hook Script Structure

All hook scripts follow this pattern:

```javascript
#!/usr/bin/env node
import { readFileSync } from "node:fs";

// Read stdin (JSON from Claude Code)
const input = JSON.parse(readFileSync("/dev/stdin", "utf8"));

// Process...
const result = {
  decision: "allow",  // or "block"
  reason: "...",
  additionalContext: "..." // injected into Claude's context
};

// Output JSON to stdout
console.log(JSON.stringify(result));
```

## Hook Source Location

```
quorum/
├── adapters/claude-code/
│   ├── hooks/hooks.json          ← 21 event registrations
│   ├── index.mjs                 ← PostToolUse (main hook)
│   ├── session-gate.mjs          ← PreToolUse (retro/audit block)
│   ├── session-start.mjs         ← SessionStart
│   ├── prompt-submit.mjs         ← UserPromptSubmit
│   └── stop.mjs                  ← Stop
├── adapters/gemini/
│   └── hooks/hooks.json          ← 11 event registrations
├── adapters/codex/
│   └── hooks/hooks.json          ← 6 event registrations
└── platform/adapters/shared/
    ├── hook-runner.mjs           ← Generic hook execution engine
    ├── hook-loader.mjs           ← HOOK.md YAML + JSON config loader
    └── hook-bridge.mjs           ← HookRunner → PreToolHook/PostToolHook adapters
```

## Related Documents

- [Agents Overview](_agents-overview.md) — agents triggered by hooks
- [Skills Overview](_skills-overview.md) — skills with frontmatter hooks
- [Graph Index](../_GRAPH-INDEX.md) — hook → script flow diagram
