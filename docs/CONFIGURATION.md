# quorum Configuration Reference

> Full config schema, hooks, parliament settings. For command usage, see [Command Reference](COMMANDS.md).

---

## Config File Location

```
.claude/quorum/config.json
```

Auto-created on first `quorum setup` from `examples/config.example.json`.

---

## Full Schema

```jsonc
{
  "consensus": {
    "trigger_tag": "[REVIEW_NEEDED]",      // Evidence submission marker
    "agree_tag": "[APPROVED]",             // Audit approval marker
    "pending_tag": "[CHANGES_REQUESTED]",  // Rejection marker
    "roles": {                             // Provider per consensus role
      "advocate": "claude",
      "devil": "claude",
      "judge": "claude"
    }
  },

  "hooks": {
    // User-defined hooks (event → handler array)
    "audit.submit": [
      {
        "name": "freeze-guard",
        "handler": {
          "type": "command",               // "command" or "http"
          "command": "node scripts/check.mjs"
        }
      }
    ]
  },

  "parliament": {
    "enabled": true,                       // Enable parliament protocol
    "convergenceThreshold": 2,             // Rounds needed for convergence
    "eligibleVoters": 3,                   // Number of voters
    "maxRounds": 10,                       // Max deliberation rounds
    "maxAutoAmendments": 5,                // Max auto-proposed amendments
    "roles": {                             // Override consensus.roles for parliament
      "advocate": "claude",
      "devil": "claude",
      "judge": "claude"
    }
  }
}
```

---

## Hook Configuration

### Event Types

Hooks can be registered for any of the 58 bus event types:

| Event | When |
|-------|------|
| `audit.submit` | Evidence submitted |
| `audit.verdict` | Audit verdict received |
| `track.complete` | Track execution finished |
| `quality.fail` | Quality check failed |

### Handler Types

**Command handler:**
```jsonc
{
  "type": "command",
  "command": "node scripts/my-hook.mjs",
  "timeout": 10000,        // ms, optional
  "async": false            // fire-and-forget if true
}
```

**HTTP handler:**
```jsonc
{
  "type": "http",
  "url": "https://hooks.example.com/notify",
  "method": "POST",
  "headers": { "Authorization": "Bearer $HOOK_TOKEN" }
}
```

Environment variable interpolation: `$VAR` or `${VAR}` in command/url/headers.

### Execution Rules

- **deny-first-break**: any handler returning `{ "decision": "block" }` stops the chain
- **async: true**: fire-and-forget, doesn't block
- **matcher**: regex filter on event payload (e.g., `"matcher": "*.ts"`)

---

## Provider Configuration

### Role-to-Provider Mapping

```jsonc
{
  "consensus": {
    "roles": {
      "advocate": "openai",     // Different model finds merit
      "devil": "claude",        // Different model challenges
      "judge": "codex"          // Different model judges
    }
  }
}
```

Priority: CLI flags > `parliament.roles` > `consensus.roles` > defaults.

---

## Templates

Custom audit/retro templates in `.claude/quorum/templates/`:

| File | Purpose |
|------|---------|
| `audit-prompt.md` | Custom audit prompt |
| `fix-prompt.md` | Custom fix prompt |
| `retro-prompt.md` | Custom retro prompt |

Reference files in `references/en/` and `references/ko/` (bilingual).

---

## Directory Layout

quorum source modules are consolidated under `platform/`. Root-level directories (`cli/`, `bus/`, `core/`, `orchestrate/`, `providers/`) still exist as thin re-export facades for backward compatibility.

```
quorum/
  platform/              ← Canonical source (new)
    cli/                   CLI dispatcher + all commands
    bus/                   Event bus, SQLite store, parliament
    core/                 Bridge, context, enforcement, MCP tools
    orchestrate/          Planning, execution, governance, state
    providers/            Consensus, trigger, AST, routing
    adapters/             Shared adapter logic + per-adapter I/O
    skills/               Skill definitions
  cli/                   ← Facade → platform/cli/
  bus/                   ← Facade → platform/bus/
  core/                  ← Facade → platform/core/ (also hosts data: templates/, locales/)
  orchestrate/           ← Facade → platform/orchestrate/
  providers/             ← Facade → platform/providers/
  adapters/              ← Facade → platform/adapters/
  agents/knowledge/      ← Cross-adapter shared protocols (not moved)
  languages/             ← Language specs + fragments (not moved)
  daemon/                ← TUI dashboard (not moved)
```

**Path resolution fallback**: `resolvePluginPath()` checks `PROJECT_CONFIG_DIR` first, then adapter env roots (`QUORUM_ADAPTER_ROOT`/`CLAUDE_PLUGIN_ROOT`/`GEMINI_EXTENSION_ROOT`), then the root `core/` directory. Both old and new layouts resolve correctly.

---

## Adapters

| Adapter | Config Source | Env Fallback |
|---------|-------------|--------------|
| Claude Code | `QUORUM_ADAPTER_ROOT` | `CLAUDE_PLUGIN_ROOT` |
| Gemini CLI | `QUORUM_ADAPTER_ROOT` | `GEMINI_EXTENSION_ROOT` |
| Codex | `QUORUM_ADAPTER_ROOT` | — |
