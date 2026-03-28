/**
 * Headless auto-planning — WB generation from CPS + design diagram auto-fix.
 *
 * Contains: autoGenerateWBs, autoFixDesignDiagrams.
 * Extracted from cli/commands/orchestrate/planner.ts for reuse.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findTracks } from "./track-catalog.js";
import { verifyDesignDiagrams } from "./design-gates.js";
import { loadCPS, loadPlannerProtocol } from "./cps-loader.js";
import { buildAutoPrompt, derivePrefix } from "./planner-prompts.js";
import { runProviderCLI } from "../core/provider-cli.js";

/** Headless WB generation from CPS (used by orchestrate run when WBs missing). */
export async function autoGenerateWBs(repoRoot: string, trackName: string, provider: string): Promise<boolean> {
  const cps = loadCPS(repoRoot);
  if (!cps) {
    console.log("  \x1b[33mNo CPS found. Run parliament first.\x1b[0m\n");
    return false;
  }

  const latestCps = cps.raw;
  console.log(`  \x1b[36mAuto-planning from CPS...\x1b[0m\n`);

  const protocol = loadPlannerProtocol(repoRoot);
  const planningDir = resolve(repoRoot, "docs", "plan");
  const prefix = derivePrefix(trackName);

  const prompt = buildAutoPrompt({
    trackName, planDir: planningDir, prefix,
    trackSlug: trackName, protocol, cpsContent: latestCps,
  });

  // Phase 1: Generate all 8 documents (single-turn spawnSync)
  console.log(`  \x1b[36mGenerating 8 documents...\x1b[0m`);
  await runProviderCLI({
    provider, args: ["-p", prompt, "--dangerously-skip-permissions"],
    cwd: repoRoot, stdio: "inherit", timeout: 300_000,
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
 */
export async function autoFixDesignDiagrams(repoRoot: string, designDir: string, violations: string[], provider: string): Promise<boolean> {
  const relDesignDir = designDir.replace(repoRoot, "").replace(/^[\\/]+/, "").replace(/\\/g, "/");
  let attempt = 0;

  while (true) {
    attempt++;

    const currentViolations = verifyDesignDiagrams(designDir);
    if (currentViolations.length === 0) {
      console.log(`  \x1b[32m✓ Design docs verified\x1b[0m (attempt ${attempt})`);
      return true;
    }

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
      urgency, "", "Tasks (do ALL of them):", ...tasks, "",
      "Rules:", "- Do NOT rewrite or delete existing content",
      "- Each diagram must be in a ```mermaid code block",
      "- Use actual names from the document, not generic placeholders",
    ].join("\n");

    console.log(`  \x1b[36m↻ Design fix attempt ${attempt}...\x1b[0m`);

    await runProviderCLI({
      provider, args: ["-p", prompt, "--dangerously-skip-permissions"],
      cwd: repoRoot, stdio: "inherit", timeout: 180_000,
    });

    const remaining = verifyDesignDiagrams(designDir);
    if (remaining.length === 0) {
      console.log(`  \x1b[32m✓ Design docs auto-fixed\x1b[0m (attempt ${attempt})`);
      return true;
    }

    console.log(`  \x1b[33m↻ Design fix incomplete (attempt ${attempt})\x1b[0m`);
    for (const v of remaining) console.log(`    ✗ ${v}`);
  }
}
