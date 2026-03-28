/**
 * Design document verification gates.
 *
 * Checks that design directory contains mandatory mermaid diagrams
 * in spec.md, blueprint.md, and domain-model.md.
 *
 * Extracted from cli/commands/orchestrate/shared.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Design diagram requirements ──────────────

const DESIGN_DIAGRAM_REQUIREMENTS: Record<string, { patterns: RegExp[]; label: string }> = {
  "spec.md":         { patterns: [/sequenceDiagram/], label: "sequenceDiagram" },
  "blueprint.md":    { patterns: [/flowchart|classDiagram|graph /], label: "flowchart or classDiagram" },
  "domain-model.md": { patterns: [/erDiagram|stateDiagram/], label: "erDiagram or stateDiagram" },
};

/**
 * Verify design directory contains mandatory mermaid diagrams.
 * Returns list of violations (empty = all pass).
 */
export function verifyDesignDiagrams(designDir: string): string[] {
  const violations: string[] = [];
  if (!existsSync(designDir)) return violations;

  for (const [file, req] of Object.entries(DESIGN_DIAGRAM_REQUIREMENTS)) {
    const filePath = resolve(designDir, file);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    const hasDiagram = req.patterns.some(p => p.test(content));
    if (!hasDiagram) {
      violations.push(`design/${file}: missing ${req.label}`);
    }
  }
  return violations;
}
