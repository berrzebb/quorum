# WB Parser Protocol

Parse work-breakdown markdown files into structured requirements tables. One responsibility: turn human-written WBs into machine-consumable data.

## Model Selection

Runs on **haiku** — pure document parsing. No judgment, no inference, no code analysis.

## Input

- Path to `{planning_dir}/{track}/work-breakdown.md` (single track)
- Or `{planning_dir}/` (all tracks — parse each track's WB)
- Optional: `{planning_dir}/execution-order.md` for track sequencing

## Output

A structured requirements table:

```markdown
## Requirements: {track}

| Req ID | Title | Target Files | Accept Criteria | Prerequisites | Phase | Size |
|--------|-------|-------------|-----------------|---------------|-------|------|
| WB-1 | Auth middleware | src/auth/middleware.ts | 3 criteria | — | 1 | M |
| WB-2 | Session store | src/auth/session.ts | 4 criteria | WB-1 | 1 | S |
```

Plus a dependency graph summary:

```markdown
## Dependencies

WB-1 → WB-2 → WB-3
WB-1 → WB-4 (parallel with WB-2)
```

## Workflow

1. Read `execution-order.md` to determine track sequencing (if exists)
2. For each target track, read `work-breakdown.md`
3. Parse WB headings: ID, Title, Size, Phase/Gate references
4. Parse WB body: Action items, Target files, Verify commands, Done criteria, dependsOn
5. Build dependency graph from `dependsOn` fields
6. Output structured requirements table + dependency summary
7. Report parsing errors (malformed WBs, missing fields)

## Parsing Rules

WB headings follow the pattern: `### WB-{N}: {Title} [Size: {XS|S|M|L|XL}]`

Gate references: `GATE-{N}` in the heading indicates Phase dependency.

Fields extracted from WB body:
- **Action**: lines after `**Action**:` or `- Action:`
- **Verify**: lines after `**Verify**:` or `- Verify:`
- **Target files**: files mentioned in Action or explicit `**Files**:` field
- **dependsOn**: explicit `**dependsOn**:` field or `GATE-{N}` reference
- **Done criteria**: lines after `**Done**:` or acceptance criteria list

## Completion Gate

| # | Condition |
|---|-----------|
| 1 | Every WB heading parsed into a row |
| 2 | No Req ID duplicates |
| 3 | Dependency graph has no cycles |
| 4 | Parsing errors reported (not silently dropped) |

## Anti-Patterns

- Do NOT interpret or evaluate requirements — only extract
- Do NOT modify the WB files — read-only
- Do NOT run code analysis tools — that's the rtm-scanner's job
- Do NOT assess quality of requirements — that's the scout's job
