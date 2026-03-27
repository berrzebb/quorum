/**
 * Interactive planner — Socratic questioning + CPS intake + parliament feedback.
 *
 * Replaces the deprecated interview.ts command. Spawns an LLM CLI session
 * with stdio:"inherit" for direct user conversation.
 *
 * --mux: Spawn in a mux session for daemon observability. The user still
 * interacts directly (auto-attach), but the daemon can observe live output.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DIST, findTracks, resolveTrack, trackRef, verifyDesignDiagrams } from "./shared.js";

/** Sanitize a track name for use as a directory name (ASCII, no spaces). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")   // remove non-word chars (includes Korean)
    .replace(/[\s_]+/g, "-")    // spaces/underscores → hyphens
    .replace(/-+/g, "-")        // collapse multiple hyphens
    .replace(/^-|-$/g, "")      // trim leading/trailing hyphens
    || "track";                  // fallback if everything was stripped
}

export async function interactivePlanner(repoRoot: string, args: string[]): Promise<void> {
  const providerIdx = args.indexOf("--provider");
  const provider = providerIdx >= 0 ? args[providerIdx + 1] ?? "claude" : "claude";
  const useMux = args.includes("--mux");
  const useAuto = args.includes("--auto");
  const providerValue = providerIdx >= 0 ? args[providerIdx + 1] : undefined;
  const trackInput = args.find(a => !a.startsWith("--") && a !== providerValue);

  // Resolve track: name, index, or auto-select
  const trackName = trackInput ?? (findTracks(repoRoot).length === 1 ? findTracks(repoRoot)[0]!.name : undefined);

  if (!trackName) {
    console.log("  Usage: quorum orchestrate plan <track|index> [--provider claude|codex|gemini|ollama|vllm] [--mux]\n");
    const tracks = findTracks(repoRoot);
    if (tracks.length > 0) {
      console.log("  Available tracks:");
      for (let i = 0; i < tracks.length; i++) {
        console.log(`    ${i + 1}. ${tracks[i]!.name} (${tracks[i]!.items} items)`);
      }
      console.log();
    }
    return;
  }

  console.log(`\n\x1b[36mquorum orchestrate plan\x1b[0m\n`);

  // Load CPS
  let cpsContent = "";
  const cpsDir = resolve(repoRoot, ".claude", "parliament");
  if (existsSync(cpsDir)) {
    const cpsFiles = readdirSync(cpsDir).filter(f => f.startsWith("cps-") && f.endsWith(".md"));
    if (cpsFiles.length > 0) {
      cpsContent = readFileSync(resolve(cpsDir, cpsFiles[cpsFiles.length - 1]!), "utf8");
      console.log(`  \x1b[32m✓\x1b[0m CPS loaded`);
    }
  }

  // Load planner protocol
  let protocol = "";
  for (const p of [resolve(repoRoot, "skills", "planner", "SKILL.md")]) {
    if (existsSync(p)) { protocol = readFileSync(p, "utf8"); break; }
  }

  const planDir = resolve(repoRoot, "docs", "plan");
  const trackSlug = slugify(trackName);
  const prefix = trackName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "TK";
  const systemPrompt = buildSystemPrompt(trackName, cpsContent, protocol, planDir, prefix, trackSlug);
  const socraticPrompt = `Plan track "${trackName}". ${cpsContent ? "CPS is available — use it." : "No CPS — start with Socratic questions to clarify requirements."}`;
  const autoPrompt = `Plan track "${trackName}" using the CPS provided. Generate ALL documents now without asking questions.

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

  // Auto mode: CPS-driven non-interactive generation (no Socratic needed)
  const autoMode = useAuto || (!useMux && cpsContent && !process.stdin.isTTY);
  console.log(`  Track: ${trackName}, Provider: ${provider}, CPS: ${cpsContent ? "yes" : "Socratic"}${useMux ? ", Mux: on" : ""}${autoMode ? ", Auto: on" : ""}\n`);

  // Build CLI args
  const initialPrompt = autoMode ? autoPrompt : socraticPrompt;
  const cliArgs: string[] = [];
  if (provider === "claude") {
    if (autoMode) {
      // Non-interactive: -p sends prompt and exits
      cliArgs.push("-p", initialPrompt, "--append-system-prompt", systemPrompt, "--dangerously-skip-permissions");
    } else {
      cliArgs.push("--append-system-prompt", systemPrompt, initialPrompt);
    }
  } else if (provider === "codex") {
    cliArgs.push("--instructions", systemPrompt);
    if (autoMode) cliArgs.push("--full-auto");
  } else {
    cliArgs.push("--system-prompt", systemPrompt);
  }

  if (useMux) {
    // Mux mode runs unattended — bypass approval prompts
    if (provider === "claude") cliArgs.push("--dangerously-skip-permissions");
    await runWithMux(repoRoot, provider, cliArgs, trackName, !!autoMode);
  } else {
    await runDirect(repoRoot, provider, cliArgs);
  }

  const wbPath = resolve(planDir, trackName, "work-breakdown.md");
  if (existsSync(wbPath)) {
    const ref = trackRef(trackName, repoRoot);
    const arg = ref ? ` ${ref}` : "";
    console.log(`\n  \x1b[32m✓ WBs generated.\x1b[0m Next: quorum orchestrate run${arg}\n`);
  }
}

// ── Direct mode (current behavior) ──────────

async function runDirect(repoRoot: string, provider: string, cliArgs: string[]): Promise<void> {
  const { spawnSync } = await import("node:child_process");
  const quorumRoot = resolve(DIST, "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  spawnSync(bin, cliArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
  });
}

// ── Mux mode (daemon observable) ────────────

async function runWithMux(repoRoot: string, provider: string, cliArgs: string[], trackName: string, autoMode = false): Promise<void> {
  const toURL = (p: string) => pathToFileURL(p).href;
  let ProcessMux: typeof import("../../../bus/mux.js").ProcessMux;
  try {
    const muxMod = await import(toURL(resolve(DIST, "bus", "mux.js")));
    ProcessMux = muxMod.ProcessMux;
  } catch {
    console.log("  \x1b[33mMux unavailable, falling back to direct mode.\x1b[0m\n");
    return runDirect(repoRoot, provider, cliArgs);
  }

  const mux = new ProcessMux();
  const backend = mux.getBackend();

  if (backend === "raw") {
    console.log("  \x1b[33mNo mux backend (psmux/tmux). Falling back to direct mode.\x1b[0m\n");
    return runDirect(repoRoot, provider, cliArgs);
  }

  console.log(`  \x1b[2mMux: ${backend} (visible in daemon [3] Agent Chat)\x1b[0m\n`);

  const sessionName = `quorum-plan-${Date.now()}`;
  let session;
  try {
    session = await mux.spawn({
      name: sessionName,
      command: provider,
      args: cliArgs,
      cwd: repoRoot,
      env: { FEEDBACK_LOOP_ACTIVE: "1" },
    });
  } catch (err) {
    console.log(`  \x1b[31mMux spawn error: ${(err as Error).message}. Falling back to direct mode.\x1b[0m\n`);
    try { await mux.cleanup(); } catch { /* ok */ }
    return runDirect(repoRoot, provider, cliArgs);
  }

  if (session.status === "error") {
    console.log("  \x1b[31mFailed to create mux session. Falling back to direct mode.\x1b[0m\n");
    try { await mux.cleanup(); } catch { /* ok */ }
    return runDirect(repoRoot, provider, cliArgs);
  }

  // Save agent state for daemon discovery
  const agentState = {
    id: session.id,
    name: session.name,
    pid: session.pid,
    backend: session.backend,
    role: "planner",
    type: "planner",
    trackName,
    startedAt: session.startedAt,
    status: session.status,
  };
  const agentsDir = resolve(repoRoot, ".claude", "agents");
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
  const stateFile = resolve(agentsDir, `${session.id}.json`);
  writeFileSync(stateFile, JSON.stringify(agentState, null, 2), "utf8");

  if (autoMode) {
    // Auto mode: poll capture for completion instead of attaching (avoids os error 6 / raw-mode on non-TTY)
    const timeout = 180_000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 5000));
      const cap = mux.capture(session.id, 200);
      if (!cap) continue;
      if (cap.output.includes('"type":"result"') || cap.output.includes('"stop_reason"') || cap.output.includes('"type":"turn.completed"')) break;
    }
  } else {
    // Interactive: attach — user interacts directly, daemon observes simultaneously
    mux.attach(session.id);
  }

  // Cleanup after completion or user exits/detaches
  try { rmSync(stateFile, { force: true }); } catch { /* ok */ }
  try { await mux.kill(session.id); } catch { /* ok */ }
  await mux.cleanup();
}

/** Headless WB generation from CPS (used by orchestrate run when WBs missing). */
export async function autoGenerateWBs(repoRoot: string, trackName: string, provider: string): Promise<boolean> {
  const cpsDir = resolve(repoRoot, ".claude", "parliament");
  const cpsFiles = existsSync(cpsDir)
    ? readdirSync(cpsDir).filter(f => f.startsWith("cps-") && f.endsWith(".md"))
    : [];

  if (cpsFiles.length === 0) {
    console.log("  \x1b[33mNo CPS found. Run parliament first.\x1b[0m\n");
    return false;
  }

  const latestCps = readFileSync(resolve(cpsDir, cpsFiles[cpsFiles.length - 1]!), "utf8");
  console.log(`  \x1b[36mAuto-planning from CPS...\x1b[0m\n`);

  let protocol = "";
  const skillPath = resolve(repoRoot, "skills", "planner", "SKILL.md");
  if (existsSync(skillPath)) protocol = readFileSync(skillPath, "utf8");

  const { spawnSync } = await import("node:child_process");
  const quorumRoot = resolve(DIST, "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  const planningDir = resolve(repoRoot, "docs", "plan");
  const prefix = trackName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);

  const d = planningDir;
  const t = trackName;
  const prompt = [
    "# Auto-Planning from Parliament CPS",
    "",
    latestCps,
    "",
    `Track: ${t}`,
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

  // Phase 1: Generate all 8 documents (single-turn spawnSync)
  console.log(`  \x1b[36mGenerating 8 documents...\x1b[0m`);
  spawnSync(bin, ["-p", prompt, "--dangerously-skip-permissions"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env },
    timeout: 300_000,
  });

  const generated = findTracks(repoRoot).some(tr => tr.name === trackName);
  if (!generated) return false;

  // Phase 2: Verify + auto-fix design diagrams (infinite retry)
  const designPath = resolve(planningDir, trackName, "design");
  const violations = verifyDesignDiagrams(designPath);

  if (violations.length > 0) {
    console.log(`  \x1b[33mDesign diagrams missing after generation, auto-fixing...\x1b[0m`);
    return autoFixDesignDiagrams(repoRoot, designPath, violations, provider);
  }

  console.log(`  \x1b[32m✓ All documents generated with diagrams\x1b[0m`);
  return true;
}

/**
 * Auto-fix design documents that are missing mandatory mermaid diagrams.
 * Each attempt spawns a FRESH `claude -p` process (single-turn, exits after response).
 * Prompt includes exact file paths so Claude knows where to edit.
 * AI에게 포기란 없다.
 */
export async function autoFixDesignDiagrams(repoRoot: string, designDir: string, violations: string[], provider: string): Promise<boolean> {
  const { spawnSync } = await import("node:child_process");
  const quorumRoot = resolve(DIST, "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  // Compute relative paths from repoRoot for the prompt
  const relDesignDir = designDir.replace(repoRoot, "").replace(/^[\\/]+/, "").replace(/\\/g, "/");

  let attempt = 0;

  while (true) {
    attempt++;

    const currentViolations = verifyDesignDiagrams(designDir);
    if (currentViolations.length === 0) {
      console.log(`  \x1b[32m✓ Design docs verified\x1b[0m (attempt ${attempt})`);
      return true;
    }

    // Build file-specific instructions with EXACT paths
    const tasks: string[] = [];
    for (const v of currentViolations) {
      const fileMatch = v.match(/design\/(\S+\.md)/);
      if (!fileMatch) continue;
      const file = fileMatch[1]!;
      const fullRelPath = `${relDesignDir}/${file}`;

      if (file === "spec.md") {
        tasks.push(`1. Read "${fullRelPath}", then Edit it to ADD a mermaid sequenceDiagram block showing the main API/component interaction flow. Use participant names from the document.`);
      } else if (file === "blueprint.md") {
        tasks.push(`2. Read "${fullRelPath}", then Edit it to ADD a mermaid flowchart TD or classDiagram block showing module dependencies. Use module/directory names from the document.`);
      } else if (file === "domain-model.md") {
        tasks.push(`3. Read "${fullRelPath}", then Edit it to ADD both: (a) a mermaid erDiagram block with entity relationships, and (b) a mermaid stateDiagram-v2 block with state transitions. Use entity names from the document.`);
      }
    }

    const urgency = attempt >= 3
      ? `URGENT (attempt ${attempt}): Previous ${attempt - 1} attempts failed to add diagrams. Follow instructions EXACTLY.`
      : "Add missing mermaid diagrams to design documents.";

    const prompt = [
      urgency,
      "",
      "Tasks (do ALL of them):",
      ...tasks,
      "",
      "Rules:",
      "- Do NOT rewrite or delete existing content",
      "- Each diagram must be in a ```mermaid code block",
      "- Use actual names from the document, not generic placeholders",
    ].join("\n");

    console.log(`  \x1b[36m↻ Design fix attempt ${attempt}...\x1b[0m`);

    spawnSync(bin, ["-p", prompt, "--dangerously-skip-permissions"], {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env },
      timeout: 180_000,
    });

    // Verify after this attempt
    const remaining = verifyDesignDiagrams(designDir);
    if (remaining.length === 0) {
      console.log(`  \x1b[32m✓ Design docs auto-fixed\x1b[0m (attempt ${attempt})`);
      return true;
    }

    console.log(`  \x1b[33m↻ Design fix incomplete (attempt ${attempt})\x1b[0m`);
    for (const v of remaining) console.log(`    ✗ ${v}`);
  }
}

function buildSystemPrompt(trackName: string, cps: string, protocol: string, planDir: string, prefix: string, trackSlug?: string): string {
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
  \`npm test -- tests/foo.test.mjs\` or \`npx tsc --noEmit\` — NOT prose.
- **Constraints**: What this WB must NOT do. Scope boundary.
  e.g. "Do NOT modify the public API" / "Do NOT add new dependencies"
- **Done**: Machine-checkable condition. e.g. "test X passes AND tsc clean"
\`\`\`

**Sizing rule**: If a WB needs >3 files or >250 lines of changes, split it.
**Action rule**: Write actions as if giving instructions to a new team member on their first day.
**Context budget rule**: List ONLY files needed — less is more. Agents use \`code_map\`/\`blast_radius\` for discovery.
**Verify rule**: Must be a runnable command, not "verify it works."

Rules: Design MANDATORY. Blueprint naming = law. Ask before assuming. User's language.

${protocol}`;
}
