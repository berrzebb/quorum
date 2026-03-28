/**
 * Planner prompt builders — pure functions that construct prompt strings
 * for the planner LLM session.
 *
 * NO file I/O, NO provider execution, NO mux control.
 * CPS loading lives in cps-loader.ts.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface SystemPromptOpts {
  trackName: string;
  cpsContent: string;
  protocol: string;
  planDir: string;
  prefix: string;
  trackSlug?: string;
}

export interface AutoPromptOpts {
  trackName: string;
  planDir: string;
  prefix: string;
  trackSlug: string;
  protocol: string;
  cpsContent: string;
}

export interface SocraticPromptOpts {
  trackName: string;
  hasCPS: boolean;
}

// ── Builders ─────────────────────────────────────────────────────────

/** Build the Socratic (interactive) initial prompt. */
export function buildSocraticPrompt(opts: SocraticPromptOpts): string {
  return `Plan track "${opts.trackName}". ${opts.hasCPS ? "CPS is available — use it." : "No CPS — start with Socratic questions to clarify requirements."}`;
}

/** Build the auto-mode initial prompt (CPS-driven, non-interactive). */
export function buildAutoPrompt(opts: AutoPromptOpts): string {
  const { trackName, planDir, prefix, trackSlug, protocol, cpsContent } = opts;
  const d = planDir;
  const t = trackSlug;

  return [
    "# Auto-Planning from Parliament CPS",
    "",
    cpsContent,
    "",
    `Track: ${trackName}`,
    "",
    `8 SEPARATE files (single responsibility each):`,
    `1. ${d}/${t}/PRD.md — WHAT/WHY`,
    `2. ${d}/${t}/design/spec.md — interfaces: API, DDL, env vars`,
    `3. ${d}/${t}/design/blueprint.md — structure: dirs, naming law`,
    `4. ${d}/${t}/design/domain-model.md — entities: ER, state machines`,
    `5. ${d}/${t}/execution-order.md — WHEN: phase graph`,
    `6. ${d}/${t}/test-strategy.md — HOW TO VERIFY`,
    `7. ${d}/${t}/work-breakdown.md (IDs: ${prefix}-1, ${prefix}-2, ...)`,
    `8. ${d}/${t}/work-catalog.md — STATUS table`,
    "",
    "MANDATORY Mermaid Diagrams:",
    "- spec.md → sequenceDiagram",
    "- blueprint.md → flowchart or classDiagram",
    "- domain-model.md → erDiagram + stateDiagram-v2",
    "",
    protocol,
  ].join("\n");
}

/**
 * Build the full-document auto prompt used by `interactivePlanner` in auto mode.
 * Includes detailed per-document responsibility breakdown.
 */
export function buildInlineAutoPrompt(opts: AutoPromptOpts): string {
  const { trackName, planDir, prefix, trackSlug } = opts;

  return `Plan track "${trackName}" using the CPS provided. Generate ALL documents now without asking questions.

Each document MUST be a separate file with a SINGLE responsibility. Do NOT merge.

## Document Responsibilities (non-overlapping)

1. **PRD** → ${planDir}/${trackSlug}/PRD.md
   WHAT and WHY. Problem statement, goals, non-goals, success criteria, risks, stakeholders.
   NO technical details. NO schemas. NO file paths.

2. **Spec** → ${planDir}/${trackSlug}/design/spec.md
   HOW (interfaces). API endpoints, request/response schemas, DB DDL (CREATE TABLE statements),
   environment variables, error codes. The contract between modules.
   NO directory layout. NO naming rules. NO entity relationships prose.

3. **Blueprint** → ${planDir}/${trackSlug}/design/blueprint.md
   HOW (structure). Directory tree, file naming conventions (= law), module boundaries,
   import rules, code style rules (3-file rule, etc.), dependency graph.
   NO DDL. NO API schemas. NO entity definitions.

4. **Domain Model** → ${planDir}/${trackSlug}/design/domain-model.md
   WHAT (entities). ER diagram, entity definitions, value objects, enums, aggregate boundaries,
   state machines, lifecycle diagrams, business rules/invariants.
   NO DDL syntax. NO file paths. NO API endpoints. (Spec translates these into DDL/API.)

5. **Execution Order** → ${planDir}/${trackSlug}/execution-order.md
   WHEN. Phase dependency graph (Phase 0→1→2), parallelizable groups,
   critical path, milestone gates. References WB IDs but NO task details.

6. **Test Strategy** → ${planDir}/${trackSlug}/test-strategy.md
   HOW TO VERIFY. Test types (unit/integration/e2e), fixture plan per source type,
   coverage targets, test tooling, CI pipeline. NO implementation steps.

7. **Work Breakdown** → ${planDir}/${trackSlug}/work-breakdown.md
   HOW TO BUILD (tasks). ${prefix}-1, ${prefix}-2, ... Each with Action/Verify/Done/Constraints.
   Implementation-level detail for sub-agents. References Spec/Blueprint/DomainModel by section.

8. **Work Catalog** → ${planDir}/${trackSlug}/work-catalog.md
   STATUS DASHBOARD. Summary table of all WBs: ID, title, size, phase, status, dependencies.
   One-row-per-task overview. NO implementation details (those live in WB).

Make reasonable decisions where CPS has gaps. Be concrete, not abstract.`;
}

/** Build the system prompt for the planner LLM session. */
export function buildPlannerSystemPrompt(opts: SystemPromptOpts): string {
  const { trackName, cpsContent: cps, protocol, planDir, prefix, trackSlug } = opts;
  const dirName = trackSlug ?? trackName;
  const cpsSection = cps
    ? `## Parliament CPS (Phase 0)\n${cps}\nMap: Context→PRD§1, Problem→PRD§2, Solution→PRD§4.`
    : "## No CPS — Socratic mode. Ask: What problem? Who benefits? Done criteria? Out of scope? Constraints?";

  return `# Planner: ${trackName}
Output to: ${planDir}/${dirName}/

${cpsSection}

## Parliament Feedback
If ambiguity cannot be resolved: tell user to run quorum parliament "<topic>".

## Output — 8 files, SINGLE responsibility each. NEVER merge.
1. PRD — ${planDir}/${dirName}/PRD.md — WHAT/WHY (no tech details)
2. Spec — ${planDir}/${dirName}/design/spec.md — interfaces: API, DDL, env vars, error codes
3. Blueprint — ${planDir}/${dirName}/design/blueprint.md — structure: dirs, naming law, imports
4. Domain Model — ${planDir}/${dirName}/design/domain-model.md — entities: ER, state machines, invariants
5. Execution Order — ${planDir}/${dirName}/execution-order.md — WHEN: phase graph, critical path
6. Test Strategy — ${planDir}/${dirName}/test-strategy.md — HOW TO VERIFY: types, fixtures, coverage
7. Work Breakdown — ${planDir}/${dirName}/work-breakdown.md — HOW TO BUILD: ${prefix}-1, ${prefix}-2, ...
8. Work Catalog — ${planDir}/${dirName}/work-catalog.md — STATUS: summary table of all WBs

## MANDATORY Mermaid Diagrams

Design docs MUST include mermaid diagrams or the orchestrator will BLOCK execution:

- **spec.md**: At least one \`\`\`mermaid\\nsequenceDiagram\`\`\` showing API call flow
- **blueprint.md**: At least one \`\`\`mermaid\\nflowchart\`\`\` or \`\`\`mermaid\\nclassDiagram\`\`\` for module dependencies
- **domain-model.md**: At least one \`\`\`mermaid\\nerDiagram\`\`\` AND one \`\`\`mermaid\\nstateDiagram-v2\`\`\`

Generate diagrams inline using actual entity/module names from the design.

## Work Breakdown Hierarchy

Use Phase/Step headings (h2) as parents, WB items (h2 with ID) as children:

\`\`\`markdown
## Phase 0: Prerequisites

## ${prefix}-1: First Task (Size: XS)
...

## Phase 1: Core Implementation

## ${prefix}-2: Second Task (Size: S)
...
\`\`\`

## Work Breakdown Schema

Each WB item MUST include these fields. The goal: a sub-agent can complete this item in ONE pass without asking questions.

\`\`\`markdown
## ${prefix}-N: Title (Size: XS|S|M)

- **First touch files**: \`path/file.ext\` — reason for each
- **Prerequisite**: ${prefix}-X (or none)
- **Action**: Concrete steps. NOT "implement X" — instead: "Add function Y to file Z that does W. Call it from Q."
- **Context budget**:
  - Read: \`file1.ts\` (interface), \`file2.ts\` (usage pattern) — files the agent MUST read
  - Skip: \`large-module/\` — files the agent must NOT explore (use tools instead)
- **Verify**: Exact command(s) to confirm completion.
  MUST include a test runner command (e.g. \`npx vitest run\`, \`npm test\`, \`npx jest\`).
  \`npx tsc --noEmit\` alone is INSUFFICIENT — type checks miss runtime bugs.
  Example: \`npx tsc --noEmit && npx vitest run src/__tests__/foo.test.ts\`
- **Constraints**: What this WB must NOT do. Scope boundary.
  e.g. "Do NOT modify the public API" / "Do NOT add new dependencies"
- **Done**: Machine-checkable condition. e.g. "test X passes AND tsc clean"
\`\`\`

**Sizing rule**: If a WB needs >3 files or >250 lines of changes, split it.
**Action rule**: Write actions as if giving instructions to a new team member on their first day.
**Context budget rule**: List ONLY files needed — less is more. Agents use \`code_map\`/\`blast_radius\` for discovery.
**Verify rule**: Must be a runnable command, not "verify it works."
**Test rule**: Each WB that creates logic (not config/style) MUST include a test in its Action steps.
  Ask: "Can I write \`expect(fn(input)).toBe(output)\` for this?" If yes → include test writing in Action.
  If no test framework exists, the FIRST WB (Wave 0) MUST set up the test framework.

### Wave 0 — Mandatory Prerequisites

If the project lacks a test framework (no \`vitest.config\`, \`jest.config\`, or test script in package.json):
- Generate a Wave 0 WB that sets up the test framework + creates a smoke test.
- All subsequent WBs depend on Wave 0.
- Wave 0 items have NO prerequisites.

Wave 0 is also for architectural prerequisites that MUST complete before any implementation (e.g. lazy init, API changes).

Rules: Design MANDATORY. Blueprint naming = law. Ask before assuming. User's language.

${protocol}`;
}

/** Derive a WB ID prefix from a track name (uppercase, max 3 chars). */
export function derivePrefix(trackName: string): string {
  return trackName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "TK";
}
