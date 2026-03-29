# Core Mission

> 구조적으로 실수를 할 수 없게 만든다.

## The Problem

AI coding assistants produce code. But no single model can reliably verify its own output.
A model that writes code and then reviews it creates a **hallucination feedback loop** — errors reinforce confidence instead of triggering correction.

## The Solution

**Structural separation of writer and auditor.**

quorum does not try to make a single model "better at reviewing." Instead, it enforces a governance structure where:

1. **One model writes** — the implementer produces code changes
2. **An independent model audits** — a separate auditor evaluates the evidence
3. **The cycle repeats** — rejection triggers correction, not escalation

This is not about model capability. A better model still cannot verify itself.
It is about **making mistakes structurally hard** through process design.

## Three Pillars

### 1. Measurable things are never asked to the LLM

Type safety, test coverage, pattern violations, build health, complexity, security vulnerabilities, dependency risks — these are **objective facts**. quorum measures them with deterministic tools (26 MCP tools, fitness score engine) before any LLM sees the code. If measurable quality drops, the submission is auto-rejected without spending audit tokens.

### 2. Deterministic tools establish facts first

Before an auditor reasons about code quality, `code_map` builds the symbol index, `blast_radius` computes transitive dependents, `perf_scan` finds N+1 queries, `a11y_scan` checks WCAG violations. The auditor receives **facts**, not raw code. This inverts the typical AI review — facts constrain inference, not the other way around.

### 3. Structure → Consensus → Convergence

The end state is **Normal Form** — a state where any implementer (human or AI, any model) produces structurally identical output given the same requirements. The parliamentary process (audit + confluence + amendments) converges all implementations toward this form. `impl(Model A, law) = impl(Model B, law)`.

## What quorum is NOT

- **Not a linter** — linters check syntax; quorum governs process
- **Not a CI tool** — CI runs tests; quorum decides whether code should exist
- **Not prompt engineering** — quorum does not improve prompts; it enforces that no single prompt's output is trusted unchecked
- **Not model-specific** — quorum works across Claude, GPT, Codex, Gemini, any provider

## Related

- [Consensus Protocol](consensus-protocol.md) — why multi-voice deliberation
- [Normal Form](normal-form.md) — convergence theory
