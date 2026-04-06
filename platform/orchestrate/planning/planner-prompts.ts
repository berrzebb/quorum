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

  // Extract binding decisions from CPS so they appear as hard constraints
  const bindingConstraints = extractBindingDecisions(opts.cpsContent);

  return `Plan track "${trackName}" using the CPS provided. Generate ALL documents now without asking questions.

## BINDING CONSTRAINTS (from Parliament CPS — DO NOT override)

These decisions were made by parliament deliberation and are NON-NEGOTIABLE:

${bindingConstraints}

Any WB that contradicts these constraints is INVALID. Use exactly the dependencies, tools, and approaches specified above.

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

- **First touch files**: \`path/file.ext\` — reason for each (list ALL files created or modified, including test files and config)
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

**HARD SIZING RULE (BLOCKING — orchestrator rejects violations)**: Each WB must touch at most 5 files in "First touch files". If a WB lists 6+ files, SPLIT it into smaller WBs. This is enforced by a gate that BLOCKS execution. Count test files too.
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

/**
 * Extract BUY/BUILD/OUT decisions from CPS content.
 * These are parliament's binding decisions that the planner must follow exactly.
 */
function extractBindingDecisions(cpsContent: string): string {
  if (!cpsContent) return "(No CPS decisions available — make reasonable choices.)";

  const lines: string[] = [];

  // Extract from Context section — contains "Decisions made:" block
  const decisionsMatch = cpsContent.match(/Decisions made:(.+?)(?=\n##|\n---|\n\n\n)/s);
  if (decisionsMatch) {
    const decisions = decisionsMatch[1]!.trim()
      .split(/;\s*/)
      .filter(d => d.length > 10)
      .slice(0, 15); // Cap to avoid prompt bloat
    if (decisions.length > 0) {
      lines.push("### Decisions (binding)");
      for (const d of decisions) lines.push(`- ${d.trim()}`);
      lines.push("");
    }
  }

  // Extract Build Items section
  const buildMatch = cpsContent.match(/## Build Items \(\d+\)\n([\s\S]*?)(?=\n---|\n## |$)/);
  if (buildMatch) {
    const items = buildMatch[1]!.trim().split("\n").filter(l => l.startsWith("- ")).slice(0, 20);
    if (items.length > 0) {
      lines.push("### Must Build (parliament-approved scope)");
      for (const item of items) lines.push(item);
      lines.push("");
    }
  }

  // Extract Gaps section
  const gapsMatch = cpsContent.match(/## Gaps \(\d+\)\n([\s\S]*?)(?=\n## |$)/);
  if (gapsMatch) {
    const gaps = gapsMatch[1]!.trim().split("\n").filter(l => l.startsWith("- ")).slice(0, 10);
    if (gaps.length > 0) {
      lines.push("### Known Gaps (address or explicitly defer)");
      for (const g of gaps) lines.push(g);
      lines.push("");
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(CPS provided but no structured decisions found — follow CPS Context section.)";
}

/** Derive a WB ID prefix from a track name (uppercase, max 3 chars). */
export function derivePrefix(trackName: string): string {
  return trackName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "TK";
}

// ── Phased Prompts (v0.6.5: split planner into sub-agents) ──

export type PlannerPhase = "prd-design" | "wb-execution";

/**
 * Build a focused prompt for a specific planner phase.
 * Phase 1 (prd-design): PRD + spec + blueprint + domain-model
 * Phase 2 (wb-execution): work-breakdown + execution-order + test-strategy + work-catalog
 */
export function buildPhasedPrompt(phase: PlannerPhase, opts: AutoPromptOpts): string {
  const { trackName, planDir, prefix, trackSlug, cpsContent } = opts;
  const d = `${planDir}/${trackSlug}`;

  if (phase === "prd-design") {
    return `Plan track "${trackName}" — Phase 1: PRD + Design Documents.

${cpsContent ? `## Parliament CPS\n${cpsContent}\n` : ""}
Generate these 4 files. Each is a SEPARATE file with SINGLE responsibility:

1. **PRD** → ${d}/PRD.md
   WHAT and WHY. Problem statement, goals, non-goals, success criteria, risks.
   NO technical details. NO schemas. NO file paths.

2. **Spec** → ${d}/design/spec.md
   HOW (interfaces). API endpoints, request/response schemas, DB DDL, env vars, error codes.
   MUST include \`\`\`mermaid\\nsequenceDiagram\`\`\` for API call flow.

3. **Blueprint** → ${d}/design/blueprint.md
   HOW (structure). Directory tree, file naming conventions, module boundaries, import rules.
   MUST include \`\`\`mermaid\\nflowchart\`\`\` or \`\`\`mermaid\\nclassDiagram\`\`\`.

4. **Domain Model** → ${d}/design/domain-model.md
   WHAT (entities). ER diagram, entity definitions, state machines, business rules.
   MUST include \`\`\`mermaid\\nerDiagram\`\`\` AND \`\`\`mermaid\\nstateDiagram-v2\`\`\`.

CRITICAL: Generate ALL 4 files now. Do NOT ask questions. Do NOT wait for confirmation. Do NOT mention "next steps" or "Phase 2". Just create the files and exit.`;
  }

  // Phase 2: WB + execution
  return `Plan track "${trackName}" — Phase 2: Work Breakdown + Execution.

READ the existing design documents first:
- ${d}/PRD.md
- ${d}/design/spec.md
- ${d}/design/blueprint.md
- ${d}/design/domain-model.md

Then generate these 4 files based on them:

1. **Work Breakdown** → ${d}/work-breakdown.md
   HOW TO BUILD. ${prefix}-1, ${prefix}-2, ... Each WB item has:
   - First touch files (max 5 per WB)
   - Prerequisite (${prefix}-X or none)
   - Action (concrete steps for a sub-agent)
   - Context budget (Read/Skip files)
   - Verify (runnable command, MUST include test runner)
   - Constraints (scope boundary)
   - Done (machine-checkable)

   HARD RULE: max 5 files per WB. If more, SPLIT.

2. **Execution Order** → ${d}/execution-order.md
   WHEN. Phase dependency graph (Phase 0→1→2), parallelizable groups,
   critical path, milestone gates. References WB IDs.

3. **Test Strategy** → ${d}/test-strategy.md
   HOW TO VERIFY. Test types, fixture plan, coverage targets, CI pipeline.

4. **Work Catalog** → ${d}/work-catalog.md
   STATUS DASHBOARD. Table of all WBs: ID, title, size, phase, status, dependencies.

CRITICAL: Generate ALL 4 files now. Do NOT ask questions. Do NOT wait for confirmation. Read the existing design docs, then create all files and exit.`;
}
