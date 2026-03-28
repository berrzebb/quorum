---
name: quorum:btw
description: "Record improvement ideas during work sessions for later analysis and skill promotion. Captures suggestions without interrupting workflow. Integrates with auto-learn pattern detection. Triggers on 'btw', 'by the way', 'idea', 'suggestion', 'improvement', '아이디어', '제안', '개선', '나중에', 'note to self'."
argument-hint: "<idea or suggestion text>"
context: main
mergeResult: false
permissionMode: acceptEdits
memory: project
skills: []
tools:
  - read
  - write
  - glob
hooks: {}
---

# BTW (By-The-Way Suggestions)

Capture improvement ideas as they arise during work. Ideas are stored, categorized, and analyzed for patterns that may warrant new skills or CLAUDE.md rules.

## Why This Matters

Good ideas surface during implementation — when you see a repeated pain point, a missing tool, or a better pattern. Without a structured capture mechanism, these insights are lost when the session ends. BTW bridges the gap between ad-hoc observation and structured improvement.

## Pipeline Phase

| Phase | Role | Active |
|-------|------|--------|
| 1. Parliament | Record deliberation insights | ✅ |
| 2. Planning | Record planning gaps | ✅ |
| 3. Design | Record design pattern observations | ✅ |
| 4. Implementation | Record implementation pain points | ✅ |
| 5. Verification | Record recurring check failures | ✅ |
| 6. Audit | Record audit rejection patterns | ✅ |
| 7. Convergence | Record convergence blockers | ✅ |
| 8. Retrospective | Suggestions feed into retrospective analysis | ✅ |

Active in **all phases** — captures ideas whenever they arise without interrupting workflow.

## Actions

### `record` (default)

Capture a suggestion with automatic categorization:

```
/quorum:btw API 응답에 trace-id를 자동 주입하는 훅이 있으면 좋겠다
```

Categories (auto-detected from content):
| Category | Signal Words |
|----------|-------------|
| `skill-request` | "skill", "스킬", "would be nice to have" |
| `tool-gap` | "tool", "도구", "scan", "check", "analyze" |
| `pattern` | "always", "every time", "항상", "매번", "반복" |
| `bug-pattern` | "bug", "broken", "fails", "버그", "에러" |
| `documentation` | "docs", "문서", "README", "unclear" |
| `general` | (default) |

Storage: suggestions are appended to `.claude/quorum/btw.jsonl` as JSONL entries:

```json
{"id": "btw-001", "text": "...", "category": "pattern", "timestamp": "2026-03-28T...", "session": "...", "context": {"file": "src/foo.ts", "task": "WB-3"}}
```

### `list`

Show recorded suggestions with optional category filter:

```
/quorum:btw list
/quorum:btw list --category pattern
```

### `analyze`

Scan suggestions for recurring patterns (3+ similar entries trigger a recommendation):

```
/quorum:btw analyze
```

Output:
```
BTW Analysis (42 suggestions, 12 sessions)

🔁 Recurring Patterns (3+ occurrences):
  1. "retry logic" mentioned 5 times → Consider: FDE checklist expansion
  2. "naming inconsistency" mentioned 4 times → Consider: blueprint_lint rule
  3. "missing i18n keys" mentioned 3 times → Consider: i18n_validate enhancement

📊 Category Distribution:
  pattern: 15 | tool-gap: 10 | skill-request: 8 | bug-pattern: 5 | general: 4
```

Integration: analysis results feed into `auto-learn.ts` repeat pattern detection. Patterns with 3+ occurrences generate CLAUDE.md rule suggestions.

### `promote`

Promote a recurring pattern to a new skill or CLAUDE.md rule:

```
/quorum:btw promote btw-015
```

This launches the `quorum:skill-authoring` workflow pre-populated with the suggestion context.

### `stats`

Quick summary of suggestion activity:

```
/quorum:btw stats
```

## Phase Transition Integration

The orchestrator reads btw suggestions at every phase transition. btw does NOT actively participate — it is **passively consumed**:

1. Orchestrator checks `.claude/quorum/btw.jsonl` at phase boundary
2. If 0 pending → no output, proceed silently
3. If pending > 0 → orchestrator outputs brief summary (top 3, max 2 turns)
4. User decides to act or ignore

btw never initiates phase-transition summaries itself — the orchestrator pulls data.

## Rules

- Recording is instant — never interrupt the user's current workflow
- Context is captured automatically (current file, active task, session ID)
- Analysis is non-blocking — it reads from the JSONL file, never modifies active state
- Promotion is a suggestion, not automatic — user confirms before creating skills/rules
- Do NOT run `analyze` during active work — wastes turns
- Do NOT auto-promote without user confirmation
- Keep phase-transition summaries to top 3 items maximum

## Anti-Patterns

- Do NOT record trivial observations ("this file is long")
- Do NOT auto-promote without user confirmation
- Do NOT store sensitive content (secrets, credentials, personal data)
- Do NOT block the current task to analyze suggestions
- Do NOT output btw summaries if 0 pending — silence is correct
