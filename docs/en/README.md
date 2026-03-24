# quorum — Plugin Reference

> Status: `active` | Package: `berrzebb/quorum`

Cross-model audit gate with structural enforcement. One model cannot approve its own code.

Edit → audit → agree → retro → commit.

---

## Why

1. **Independent critique** — the writing AI and the reviewing AI are separate. A single model cannot catch its own blind spots.
2. **No consensus, no progress** — items tagged `[trigger_tag]` remain incomplete until promoted to `[agree_tag]`.
3. **Automatic retrospective** — after consensus, the session gate blocks commits until retrospective completes.
4. **Policy as data** — audit criteria live in `references/` files. Adjust team policy without code changes.

---

## Audit Flow

```
code edit → PostToolUse hook
    │
    ├─ [1] Regex first pass (runPatternScan)
    │       → candidate file:line list
    │
    ├─ [2] AST second pass (ast-analyzer)
    │       → false positive removal + type context
    │       ※ runs only when candidates exist
    │
    ├─ [3] Fitness score computation (fitness.ts)
    │       → 7 components → single 0.0-1.0 score
    │
    ├─ [4] Fitness gate (fitness-loop.ts)
    │       ├─ auto-reject: score drop → skip LLM audit
    │       ├─ self-correct: mild drop → warn and continue
    │       └─ proceed: stable/improved → continue
    │
    ├─ [5] Trigger evaluation (12-factor scoring, incl. fitness + blast radius + velocity + stagnation)
    │       ├─ T1 skip (micro change, no audit)
    │       ├─ T2 simple (single auditor)
    │       └─ T3 deliberative (Advocate + Devil's Advocate → Judge)
    │
    ├─ [6] Stagnation check (5 patterns, incl. fitness-plateau)
    │       → escalation if stuck
    │
    ├─ [7] Audit spawn (background)
    │       ↓
    │   verdict → tag sync
    │       ↓
    │   ┌── [agree_tag] → retro gate → commit
    │   └── [pending_tag] → correction → resubmit
    │
    └─ [8] Quality rules (eslint, tsc)
```

---

## CLI

```bash
quorum setup              # initialize project
quorum daemon             # TUI dashboard
quorum status             # gate status (incl. parliament)
quorum audit              # manual trigger
quorum plan               # list work breakdowns
quorum parliament "topic" # parliamentary deliberation
quorum ask codex "..."    # direct provider query
quorum tool code_map      # run MCP tool
quorum tool blueprint_lint # naming convention check
```

---

## Parliament Protocol

Legislative metaphor for structured consensus: topic → deliberation → CPS → Design → PRD → WB → audit.

```bash
quorum parliament "payment system design"          # basic
quorum parliament --rounds 3 "auth design"         # multi-round convergence
quorum parliament --mux "system design"            # daemon-observable sessions
quorum parliament --history                       # review past sessions
quorum parliament --resume <id>                   # continue deliberation
```

### Enforcement Gates

5 structural gates that **block work** (not just document):

| Gate | Blocks When | Bypass |
|------|------------|--------|
| Amendment | Pending amendments unresolved | `--force` |
| Verdict | Latest audit != approved | `--force` |
| Confluence | Verification failed | `--force` |
| Design | Design artifacts missing | `--force` |
| Regression | Normal-form stage regressed | alert only |

---

## Deliberative Consensus (T3)

| Round | Roles | Purpose |
|-------|-------|---------|
| 1 (parallel) | Advocate + Devil's Advocate | Independent analysis (free speech) |
| 2 (sequential) | Judge | Converge into 4 MECE registers + 5-classification |

Parliament mode adds: meeting log accumulation → convergence detection → CPS generation → auto-amendment proposal.

---

## Domain Specialists

Auto-detects domains from file patterns, conditionally activates domain-specific deterministic tools + LLM agents:

| Domain | Tool | Agent |
|--------|------|-------|
| perf | `perf_scan` | perf-analyst |
| a11y | `a11y_scan` | a11y-auditor |
| migration | `compat_check` | compat-reviewer |
| i18n | `i18n_validate` | i18n-checker |
| compliance | `license_scan` | compliance-officer |
| infra | `infra_scan` | infra-validator |
| observability | `observability_check` | observability-inspector |
| concurrency | — | concurrency-verifier |
| documentation | `doc_coverage` | doc-steward |

**19 deterministic tools** — see [TOOLS.md](TOOLS.md) for details.

### TUI Dashboard

The daemon TUI (`quorum daemon`) includes:
- **GateStatus**: enforcement gate visualization (Audit/Retro/Quality)
- **FitnessPanel**: real-time fitness score, sparkline history, component breakdown, gate decision
- **AgentPanel**: active agent tracking
- **TrackProgress**: work breakdown status
- **AuditStream**: live event stream

---

## Hybrid Scanning

Solves regex false positives with AST analysis:

```
Regex first pass (fast, <1ms/file)
    │
    ├─ scan-ignore pragma removes self-referential matches
    │
    └─ AST second pass (precise, <50ms/file)
        ├─ comment/string context → false positive removal
        ├─ while(true) + break/return → safe-loop downgrade
        └─ type assertion context analysis
```

**3-layer defense**: scan-ignore (L1) → AST context filter (L2) → AST control flow (L3). Each layer fail-open independently.

**Program mode** (`ts.createProgram()`): cross-file analysis — unused export detection, import cycle detection via DFS.

---

## Fitness Score Engine

Inspired by Karpathy's autoresearch: **what is measurable is not asked to the LLM.**

| Component | Weight | Input |
|-----------|--------|-------|
| Type Safety | 0.25 | `as any` count / KLOC |
| Test Coverage | 0.25 | line + branch coverage |
| Pattern Scan | 0.20 | HIGH findings count |
| Build Health | 0.15 | tsc + eslint pass rate |
| Complexity | 0.15 | avg cyclomatic complexity |

**3-tier gate**:
- **auto-reject**: score drop (delta ≤ -0.15) or absolute < 0.3 → skip LLM audit (cost savings)
- **self-correct**: mild drop (-0.15 < delta ≤ -0.05) → warn agent
- **proceed**: stable/improved → normal flow, update baseline on improvement

---

## 3-Layer Adapter Pattern (v0.4.2)

Shared business logic across adapters. Only I/O differs per runtime:

| Layer | Role | Location |
|-------|------|----------|
| **I/O** | stdin/stdout parsing, protocol | `adapters/{adapter}/` |
| **Business Logic** | trigger, evidence, hooks, NDJSON | `adapters/shared/` (17 modules) |
| **Core** | audit, 19 MCP tools, EventStore | `core/` |

New adapter = ~280 lines of I/O wrappers (Codex adapter).

### HookRunner Engine

User-defined hooks in `config.json` or `HOOK.md`:

```jsonc
{
  "hooks": {
    "audit.submit": [
      { "name": "freeze-guard", "handler": { "type": "command", "command": "node scripts/check.mjs" } }
    ]
  }
}
```

command/http handlers, env interpolation (`$VAR`), deny-first-break, async fire-and-forget, regex matcher.

### Multi-Model NDJSON Protocol

3 CLI runtimes → unified `AgentOutputMessage`:

| Runtime | Format | Adapter |
|---------|--------|---------|
| Claude Code | `stream-json` | `ClaudeCliAdapter` |
| Codex | `exec --json` | `CodexCliAdapter` |
| Gemini | `stream-json` | `GeminiCliAdapter` |

`MuxAdapter` bridges ProcessMux (tmux/psmux) for cross-model consensus.

---

## Providers

| Provider | Mechanism | Hooks | Status |
|----------|-----------|-------|--------|
| Claude Code | 22 native hooks | SessionStart, PreToolUse, PostToolUse, Stop, PermissionRequest, Notification, ... | Active |
| Gemini CLI | 11 native hooks | SessionStart, BeforeAgent, AfterAgent, BeforeTool, AfterTool, ... | Active |
| Codex CLI | 5 native hooks | SessionStart, Stop, UserPromptSubmit, AfterAgent, AfterToolUse | Active |

---

## Configuration

`.claude/quorum/config.json`:

```jsonc
{
  "consensus": {
    "watch_file": "docs/feedback/claude.md",
    "trigger_tag": "[REVIEW_NEEDED]",
    "agree_tag": "[APPROVED]",
    "pending_tag": "[CHANGES_REQUESTED]"
  },
  "hooks": {}
}
```
