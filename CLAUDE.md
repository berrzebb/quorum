# quorum

Cross-model audit gate with structural enforcement. Edit → audit → agree → retro → commit.

## Quick Commands

```bash
npm run build          # tsc compile
npm run typecheck      # tsc --noEmit
npm test               # node --test tests/*.test.mjs
npm run dev            # tsx daemon/index.ts
```

## Module Map

```
cli/index.ts           ← quorum <command> dispatcher
  ├→ commands/setup.ts  ← project initialization
  ├→ commands/status.ts ← gate status (no TUI)
  ├→ commands/audit.ts  ← manual audit trigger
  ├→ commands/plan.ts   ← work breakdown listing
  ├→ commands/ask.ts    ← provider direct query
  └→ commands/tool.ts   ← MCP tool CLI

daemon/index.ts         ← Ink TUI entry point
  └→ app.tsx            ← GateStatus + AgentPanel + TrackProgress + AuditStream

bus/
  ├→ bus.ts             ← QuorumBus (EventEmitter + SQLite/JSONL)
  ├→ store.ts           ← EventStore (SQLite WAL) + UnitOfWork
  ├→ events.ts          ← 30+ event types
  ├→ stagnation.ts      ← 4-pattern detection
  └→ mux.ts             ← ProcessMux (tmux/psmux/raw)

providers/
  ├→ provider.ts        ← QuorumProvider + Auditor interfaces
  ├→ consensus.ts       ← DeliberativeConsensus (Advocate/Devil/Judge)
  ├→ trigger.ts         ← 6-factor conditional trigger (T1/T2/T3)
  ├→ router.ts          ← TierRouter (escalation/downgrade)
  ├→ agent-loader.ts    ← 4-tier persona resolution + LRU cache
  ├→ claude-code/       ← ClaudeCodeProvider (hook-forwarding)
  └→ codex/             ← CodexProvider (file-watch) + CodexAuditor

core/
  ├→ bridge.mjs         ← MJS hooks ↔ TS modules bridge
  ├→ context.mjs        ← config, paths, parser, i18n, readJsonlFile
  ├→ cli-runner.mjs     ← cross-platform spawn (resolveBinary, execResolved, gitSync)
  ├→ audit.mjs          ← pre-verification + auditor spawn
  ├→ respond.mjs        ← tag sync + verdict recording
  ├→ enforcement.mjs    ← structural enforcement
  └→ tools/             ← 9 MCP tools (code_map, rtm_parse, fvm_generate, ...)

adapters/claude-code/
  ├→ index.mjs          ← PostToolUse hook (trigger eval + bridge)
  ├→ session-gate.mjs   ← PreToolUse (retro enforcement)
  ├→ hooks/hooks.json   ← 12 hook registrations
  ├→ skills/            ← 9 skills
  ├→ agents/            ← implementer, scout, ui-reviewer
  └→ commands/          ← 9 CLI shortcuts
```

## Key Patterns

- **Bridge**: `core/bridge.mjs` connects MJS hooks to compiled TS modules. Fail-safe — hooks run in legacy mode if dist/ is unavailable.
- **Consensus Gate**: evidence → trigger eval → T1 skip / T2 simple / T3 deliberative → verdict → retro → commit.
- **SQLite EventStore**: WAL mode for concurrent access (hooks write, TUI reads). No IPC needed.
- **ProcessMux**: auto-detects tmux (Unix) / psmux (Windows) / raw fallback. Offers to install if missing.
- **Fail-open**: all hooks pass through on error. No system lockout.

## Testing

```bash
npm test                              # all (387 tests)
node --test tests/e2e-smoke.test.mjs  # full pipeline
node --test tests/bridge.test.mjs     # MJS↔TS bridge
node --test tests/store.test.mjs      # SQLite EventStore
```
