---
name: quorum-retrospect
description: "Extract learnings from audit history and conversation, manage memories. Use after completing a track, during retrospective, or for memory maintenance. Triggers on 'what did we learn', 'retrospective', 'memory cleanup', '회고'."
argument-hint: "[track name or 'all']"
model: codex
allowed-tools: read_file, write_file, shell, find_files, search
---

# Retrospect Protocol

Mine the session for learnings and persist what's worth remembering.

## Codex Tool Mapping

| Operation | Tool |
|-----------|------|
| Read file | `read_file` |
| Write file | `write_file` |
| Edit file | `apply_diff` |
| Run command | `shell` |
| Find files | `find_files` |
| Search content | `search` |
| Spawn agent | `create_agent` |

## Mode Selection

| Signal | Mode | Phases |
|--------|------|--------|
| Casual ("learnings") | **Quick** | 1a, 3, 6 |
| Maintenance ("cleanup") | **Full** | 1-6 |
| Track argument | **Full** | 1-6 |
| During retro step 3 | **Full** | 1-6 |

Auto-selected — do not ask.

## Execution Context

**Interactive**: present candidates, wait for approval. **Headless**: auto-approve threshold-met, defer ambiguous, report. NEVER ask questions in headless mode.

## Setup

Config: `.quorum/config.json` -> `plugin.locale`. Find `**/memory/MEMORY.md` via `find_files`. Check existing memories, line count < 200.

## Phase 1: Gather

**Quick**: conversation + `git log --oneline -30`. **Full**: add `quorum tool audit_history --summary --json`.

## Phase 2: Deduplicate (Full)

Read memory files, build topic index, mark candidates "new" or "update".

## Phase 3: Candidates

Categories: **feedback**, **project**, **user**, **reference**. Each needs: category, source, content, why, how to apply (feedback/project required). Thresholds (headless): rejection feedback -> approve; 2+ pattern -> approve; single -> defer.

## Phase 4: Present (Interactive)

Table: category, source, action. Wait for confirmation.

## Phase 5: Execute

Write to `MEMORY.md`. New: append. Update: `apply_diff`. Prefer update over create.

## Phase 6: Verify (Full)

Line count < 200, no duplicates, index matches files.

## Integration

During post-audit retro step 3: handles memory. Code-change learnings -> work-catalog items, not memories.

## Memory Authority

| Actor | Access |
|-------|--------|
| `quorum-retrospect` | Read + Write |
| Agents | Read only |
| Other skills | No access |

## Rules

1. Gather all sources before generating candidates
2. Deduplicate before presenting (Full)
3. Every candidate cites a source
4. User approves (interactive) / auto-approve (headless)
5. Why + How required for feedback/project
6. Prefer update over create
7. Never block in headless mode
