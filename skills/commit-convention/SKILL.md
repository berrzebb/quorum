---
name: quorum:commit-convention
description: "Git commit best practices — analyzes staged changes, determines split boundaries, and writes Conventional Commits messages. Use this skill before any git commit, when reviewing staged changes, or when asking how to write commit messages. Project CLAUDE.md conventions take precedence. Triggers on 'commit', 'git commit', 'commit message', 'how should I commit', '커밋', '커밋 메시지', '커밋 컨벤션'."
argument-hint: "[--check | --split-advice]"
---

# Commit Convention

Follow this skill before creating a commit.

> **Project conventions first**: If the project has a CLAUDE.md with commit rules
> (subject language, allowed types, ticket prefix format), those override this skill's defaults.

## Workflow

### Step 1: Understand staged changes

Run `git diff --staged --stat` and `git diff --staged` to see what changed.

### Step 2: Determine commit granularity

**Rule: one logical change per commit** — not one file, not one line count.

Signs you should split:
- The subject line needs "and" to describe what changed
- More than one Conventional Commit type applies (e.g., `feat` + `refactor`)
- Refactoring is mixed with behavior change
- You can imagine wanting to revert only part of this commit

Read `skills/commit-convention/references/split-patterns.md` for detailed split strategies.

### Step 3: Write the subject line

```
type(scope): subject
type(scope)!: subject          ← breaking change
```

**Rules** (Conventional Commits + Tim Pope + Chris Beams):
- 50 characters or less
- **Subject language: Korean by default** (technical identifiers in English are fine)
  — override with project CLAUDE.md if the project uses a different language
- Imperative or noun form: "기능 추가" not "기능을 추가했다"
- Lowercase `type` and `scope`; no period at the end

Read `skills/commit-convention/references/types.md` for the standard type list and scope conventions.

### Step 4: Write the body

Err on the side of writing one. Commits are permanent history.

**Body is necessary when:**
- The reason isn't obvious from the code
- Bug fix: root cause explanation needed
- Alternative approach was considered and rejected
- Performance claim: include numbers

**Subject alone is sufficient for:**
- `docs: fix typo in README`
- `chore: bump dependency versions`

Read `skills/commit-convention/references/body-guide.md` for format, examples, and what to write vs. avoid.

## Checklist

Before committing, verify:

- [ ] Staged changes represent a single logical change?
- [ ] Subject avoids "and"?
- [ ] Refactoring and behavior changes separated?
- [ ] Subject in imperative mood, ≤ 50 chars, no period?
- [ ] Body explains *why* (if needed)?
