# Consensus Tools Eval Prompt

Run code_map on src/auth/ and blast_radius on the changed files.

## Context

I'm preparing evidence for an auth middleware implementation. Before submitting, I need to understand the code structure and impact of my changes.

Changed files:
- `src/auth/login.ts`
- `src/auth/register.ts`
- `src/middleware/auth.ts`
- `src/middleware/rate-limit.ts`

## Tasks

1. Run `code_map` on the `src/auth/` directory to get the structural overview (exports, imports, functions)
2. Run `blast_radius` on the changed files to understand the impact surface
3. Interpret the results: Which files are directly affected? What is the transitive dependency impact?
4. Based on the results, assess whether this change is low-risk or high-risk for the audit trigger

## Instructions

Show the exact tool invocations, explain the parameters, and interpret the JSON output.
