# L1: Public Document Sync

## Extraction Commands

Run these to collect current facts from code:

```bash
# Hook counts (per adapter — count event registrations, not top-level keys)
node -e "const h=JSON.parse(require('fs').readFileSync('platform/adapters/claude-code/hooks/hooks.json','utf8')).hooks; let c=0; for(const k in h) c+=h[k].length; console.log('claude-code:',c)"
node -e "const h=JSON.parse(require('fs').readFileSync('platform/adapters/gemini/hooks/hooks.json','utf8')).hooks; let c=0; for(const k in h) c+=h[k].length; console.log('gemini:',c)"
node -e "const h=JSON.parse(require('fs').readFileSync('platform/adapters/codex/hooks/hooks.json','utf8')).hooks; let c=0; for(const k in h) c+=h[k].length; console.log('codex:',c)"

# Shared module count
ls adapters/shared/*.mjs | wc -l

# MCP tool count (name: entries in TOOLS array)
grep -c '"name":' platform/core/tools/mcp-server.mjs

# Test count
npm test 2>&1 | grep -oP 'tests \K\d+'

# Agent count (per adapter)
ls adapters/claude-code/agents/*.md 2>/dev/null | wc -l
ls adapters/gemini/agents/*.md 2>/dev/null | wc -l
ls adapters/codex/agents/*.md 2>/dev/null | wc -l

# Skill count (per adapter + shared)
ls skills/*/SKILL.md | wc -l
ls adapters/claude-code/skills/*/SKILL.md | wc -l
ls adapters/gemini/skills/*/SKILL.md | wc -l
ls adapters/codex/skills/*/SKILL.md | wc -l

# Command count (per adapter)
ls adapters/claude-code/commands/*.md 2>/dev/null | wc -l
ls adapters/gemini/commands/*.toml 2>/dev/null | wc -l

# Version
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)"

# Trigger factor count
grep -cP '^\s*//\s*\d+\.' providers/trigger.ts

# Stagnation pattern count
grep -c 'pattern:' bus/stagnation.ts 2>/dev/null

# Event type count
grep -cP "'" bus/events.ts

# Language count + fragments
ls -d languages/*/spec.mjs | wc -l
for lang in languages/*/; do echo "$(basename $lang): $(ls $lang/spec.*.mjs 2>/dev/null | wc -l) fragments"; done
```

## Target Files

| File | Facts to Check |
|------|---------------|
| `README.md` | Version, hook counts, tool count, test count, module count, adapter table |
| `README.ko.md` | Same facts, Korean version — numbers must match EN |
| `docs/README.md` | Module map, hook counts, tool count, adapter table |
| `docs/ko-KR/README.md` | Same, Korean |
| `docs/AGENTS.md` | Trigger factors, tool table, stagnation patterns, language count |
| `docs/ko-KR/AGENTS.md` | Same, Korean |
| `docs/TOOLS.md` | One `##` section per MCP tool |
| `docs/ko-KR/TOOLS.md` | Same sections, Korean |

## Matching Rules

### Numeric Mismatch Detection

Search documents for these patterns and compare against extracted values:

```
(\d+)\s*(hooks?|훅)              → per-adapter or total hook count
(\d+)\s*(tools?|도구)            → MCP tool count
(\d+)\s*(tests?|테스트)          → test count
(\d+)\s*(modules?|모듈)          → shared module count
(\d+)\s*(agents?|에이전트)       → agent count
(\d+)\s*(skills?|스킬)           → skill count
(\d+)\s*(commands?|커맨드|명령)   → command count
(\d+)\s*(events?|이벤트)         → event type count
(\d+).*(factor|팩터)             → trigger factor count
(\d+).*(pattern|패턴)            → stagnation pattern count (within stagnation section)
(\d+).*(languages?|언어)         → language count
(\d+).*(fragments?|프래그먼트)    → fragment count
```

**Context matters**: verify the number refers to the correct adapter/module before changing. "22 hooks" in a Claude Code section means Claude Code hooks, not total.

### Section Parity (EN/KO)

Extract `## ` headers from each EN/KO document pair:
- EN has section, KO doesn't → **add** (match existing style)
- KO has section, EN doesn't → **report only** (may be intentional)

### Adapter Table

All adapters with `platform/adapters/<adapter>/hooks/hooks.json` must have a row in the provider/adapter table:
- Claude Code
- Gemini
- Codex

### Tool Sections (TOOLS.md)

Every tool `name` in `platform/core/tools/mcp-server.mjs` TOOLS array must have a `## tool_name` section in TOOLS.md (both EN and KO).
