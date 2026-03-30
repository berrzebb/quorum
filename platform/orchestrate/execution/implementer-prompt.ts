/**
 * Implementer prompt builder — constructs prompt text for implementer agents.
 *
 * Pure function. Takes work item data + context, returns prompt string.
 * No provider execution, no file I/O beyond reading protocol/domain docs.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkItem } from "../planning/types.js";
import { buildDepContextFromManifests, type WaveManifest } from "./dependency-context.js";

/** Agent roster entry — who else is running in this wave. */
export interface RosterEntry {
  agentId: string;
  wbId: string;
  targetFiles: string[];
  dependsOn: string[];
}

/**
 * Build the full implementer prompt for a work item.
 *
 * Assembles: task header, target files, action/context/constraints/verify,
 * dependency context (from manifests), peer roster, domain knowledge,
 * and implementer protocol.
 */
export function buildImplementerPrompt(
  item: WorkItem, trackName: string, repoRoot: string,
  roster?: RosterEntry[],
  manifests?: WaveManifest[],
  detectedDomains?: string[],
): string {
  let protocol = "";
  try {
    const p = resolve(repoRoot, "agents", "knowledge", "implementer-protocol.md");
    if (existsSync(p)) protocol = readFileSync(p, "utf8");
  } catch (err) { console.warn(`[implementer-prompt] protocol load failed: ${(err as Error).message}`); }

  // Inject domain-specific knowledge for detected domains
  let domainKnowledge = "";
  if (detectedDomains && detectedDomains.length > 0) {
    const domainSections: string[] = [];
    for (const domain of detectedDomains) {
      try {
        const domainPath = resolve(repoRoot, "agents", "knowledge", "domains", `${domain}.md`);
        if (existsSync(domainPath)) {
          const content = readFileSync(domainPath, "utf8");
          domainSections.push(`### ${domain.toUpperCase()} Domain\n${content.slice(0, 1500)}`);
        }
      } catch (err) { console.warn(`[implementer-prompt] domain knowledge load failed for ${domain}: ${(err as Error).message}`); }
    }
    if (domainSections.length > 0) {
      domainKnowledge = `\n## Domain-Specific Guidance\n\nThis task touches ${detectedDomains.join(", ")} domain(s). Review these checklists BEFORE implementing:\n\n${domainSections.join("\n\n---\n\n")}\n`;
    }
  }

  const files = item.targetFiles.length > 0
    ? item.targetFiles.map(f => `- ${f}`).join("\n")
    : "Identify targets from context.";

  // Dependency context injection (mechanical — orchestrator reads from MessageBus)
  const depContext = buildDepContextFromManifests(item, manifests ?? []);

  // Peer roster (informational — who else is running in this wave)
  const peers = (roster ?? [])
    .filter(r => r.agentId !== `impl-${item.id}`)
    .map(r => `- ${r.agentId}: ${r.wbId} (files: ${r.targetFiles.join(", ") || "TBD"})`)
    .join("\n");
  const peerSection = peers ? `\n## Active Peers (same wave)\n${peers}\n` : "";

  // Action / Context Budget / Verify / Constraints — from WB schema
  const actionSection = item.action
    ? `## Action\n${item.action}`
    : "";
  const ctxSection = item.contextBudget
    ? `## Context Budget\n- **Read first**: ${item.contextBudget.read.map(f => `\`${f}\``).join(", ") || "none specified"}\n- **Do NOT explore**: ${item.contextBudget.skip.join(", ") || "none"}\nUse \`code_map\`/\`blast_radius\` for anything outside this list.`
    : "";
  const verifySection = item.verify
    ? `## Verify\nRun this BEFORE submitting evidence:\n\`\`\`bash\n${item.verify}\n\`\`\``
    : "";
  const constraintSection = item.constraints
    ? `## Constraints\n${item.constraints}`
    : "";

  const scopeWarning = item.targetFiles.length > 0
    ? `\n## SCOPE RESTRICTION (CRITICAL)\nYou MUST only create/modify the files listed in "Target Files" above.\nDo NOT create files for other work breakdown items. Do NOT implement features beyond this WB.\nOther WBs will handle their own files — implementing them here causes scope violations and audit failure.\n`
    : "";

  return `# Task: ${item.id} (Track: ${trackName})

## Target Files
${files}
${scopeWarning}
${item.dependsOn ? `## Dependencies: ${item.dependsOn.join(", ")}` : ""}
${actionSection}
${ctxSection}
${constraintSection}
${verifySection}
${depContext}${peerSection}${domainKnowledge}
## Instructions
Implement ONLY this work breakdown item (${item.id}). Do not implement other items.
Follow the implementer protocol. When done, run the verify command to confirm your work is correct.

${protocol}`;
}
