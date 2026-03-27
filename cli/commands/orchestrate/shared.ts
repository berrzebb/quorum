/**
 * Orchestrate shared utilities — types, bridge loader, track/WB parsing.
 *
 * Used by: planner.ts, runner.ts, lifecycle.ts, and the orchestrate dispatcher.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DIST = resolve(__dirname, "..", "..", "..");

// ── Types ────────────────────────────────────

export type Bridge = Record<string, Function>;

export type WBSize = "XS" | "S" | "M";

export interface WorkItem {
  id: string;
  /** Human-readable title from WB heading */
  title?: string;
  targetFiles: string[];
  dependsOn?: string[];
  /** WB complexity: XS (~15-50 lines), S (~60-150), M (~180-250) */
  size?: WBSize;
  /** Concrete action steps (what to do, not "implement X") */
  action?: string;
  /** Files to read (context) and files to skip */
  contextBudget?: { read: string[]; skip: string[] };
  /** Runnable verification command */
  verify?: string;
  /** Scope boundaries — what NOT to do */
  constraints?: string;
  /** Done criteria */
  done?: string;
  /** Parent feature ID (null for top-level parents) */
  parentId?: string;
  /** Whether this is a parent (feature) or child (task) item */
  isParent?: boolean;
  /** Integration target — what this parent's scenario test verifies */
  integrationTarget?: string;
}

export interface TrackInfo {
  name: string;
  path: string;
  items: number;
}

// ── Bridge loader ────────────────────────────

export async function loadBridge(repoRoot: string): Promise<Bridge | null> {
  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    // Bridge is in the quorum package, not the target project
    const quorumRoot = resolve(DIST, "..");
    const bridge = await import(toURL(resolve(quorumRoot, "core", "bridge.mjs")));
    await bridge.init(repoRoot);
    return bridge;
  } catch { return null; }
}

// ── Track discovery ──────────────────────────

export function findTracks(repoRoot: string): TrackInfo[] {
  const tracks: TrackInfo[] = [];
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanDir(dir, tracks);
  }

  const seen = new Set<string>();
  return tracks.filter(t => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
}

function scanDir(dir: string, tracks: TrackInfo[]): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, tracks);
      } else if (entry.name.includes("work-breakdown") && entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf8");
        const bracketItems = content.match(/^###?\s+\[/gm) ?? [];
        const idItems = content.match(/^#{2,3}\s+[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+/gm) ?? [];
        tracks.push({
          name: basename(resolve(fullPath, "..")),
          path: fullPath,
          items: Math.max(bracketItems.length, idItems.length),
        });
      }
    }
  } catch { /* skip */ }
}

// ── Track resolution (name, index, or auto) ──

/**
 * Resolve a track by name, numeric index (1-based), or auto-select if only one exists.
 * Returns null if not found.
 */
export function resolveTrack(input: string | undefined, repoRoot: string): TrackInfo | null {
  const tracks = findTracks(repoRoot);
  if (tracks.length === 0) return null;

  // No input: auto-select if only one track
  if (!input) {
    return tracks.length === 1 ? tracks[0]! : null;
  }

  // Numeric index (1-based)
  const idx = parseInt(input, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= tracks.length) {
    return tracks[idx - 1]!;
  }

  // Exact name match
  const exact = tracks.find(t => t.name === input);
  if (exact) return exact;

  // Prefix match (case-insensitive)
  const prefix = tracks.filter(t => t.name.toLowerCase().startsWith(input.toLowerCase()));
  if (prefix.length === 1) return prefix[0]!;

  return null;
}

/**
 * Format a short track reference for next-step suggestions.
 * Uses index if available, falls back to name.
 */
export function trackRef(trackName: string, repoRoot: string): string {
  const tracks = findTracks(repoRoot);
  if (tracks.length === 1) return "";  // no arg needed
  const idx = tracks.findIndex(t => t.name === trackName);
  return idx >= 0 ? String(idx + 1) : trackName;
}

// ── Work Breakdown Parser ────────────────────

export function parseWorkBreakdown(wbPath: string): WorkItem[] {
  let content: string;
  try {
    content = readFileSync(wbPath, "utf8");
  } catch {
    return [];
  }

  const items: WorkItem[] = [];

  // Detect hierarchy: h2 = parent (feature/phase/step), h3 = child (task)
  // Supports two parent formats:
  //   1. ID-based:    ## WEB-1: Feature Title
  //   2. Phase-based: ## Phase 1: Multi-Clip Scheduling  /  ## Step 2: Effects
  // If no h2 parents exist, treat all as flat children (backwards compatible)
  // ID pattern: WEB-1, DAW-P2-01, FEAT-3A, PROJECT-TRACK-42
  // Must start with uppercase letter, contain at least one hyphen, end with digits (optional letter suffix)
  const ID_PATTERN = /[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?/;
  const PARENT_LABEL_PATTERN = /(?:Phase|Step|단계)\s*\d+[A-Za-z]?/;

  // Check for h2 parents — Phase/Step labels take precedence over ID headings
  // If both Phase labels AND ID headings exist at h2, Phase labels are parents.
  const h2PhaseRegex = /^##\s+(?:Phase|Step|단계)\s*\d+[A-Za-z]?[:\s]/gm;
  const hasPhaseParents = h2PhaseRegex.test(content);
  h2PhaseRegex.lastIndex = 0;

  // ID-based parents only if no Phase labels exist (backwards compat: h2=parent, h3=child)
  const h2IdRegex = /^##\s+(?:\[)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?)\]?[:\s]/gm;
  const h3IdRegex = /^###\s+(?:\[)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?)\]?[:\s]/gm;
  const hasIdParents = !hasPhaseParents && h2IdRegex.test(content) && h3IdRegex.test(content);
  h2IdRegex.lastIndex = 0;
  h3IdRegex.lastIndex = 0;
  const hasParents = hasPhaseParents || hasIdParents;

  // Build section map with heading level awareness
  const sections: { id: string; start: number; level: number; title?: string }[] = [];

  if (hasParents) {
    // Two-pass classification to avoid lazy-quantifier issues:
    // Pass 1: Find Phase/Step parents (greedy match on known labels)
    // Pass 2: Find ID-based children
    let match: RegExpExecArray | null;

    // Pass 1: Parents — "## Phase 0:", "## Step 2A:", "## 단계 3:"
    const parentRegex = /^#{2,3}\s+((?:Phase|Step|단계)\s*\d+[A-Za-z]?)\s*:\s*(.*)/gm;
    while ((match = parentRegex.exec(content)) !== null) {
      const id = match[1]!.replace(/\s+/g, "-");
      sections.push({ id, start: match.index, level: 2, title: match[2]?.trim() });
    }

    // Pass 2: Children — "## DAW-P2-01:", "### WEB-1:", "## PAY-1 Title"
    const childRegex = /^#{2,3}\s+(?:\[)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?)\]?\s*[:\s]\s*(.*)/gm;
    while ((match = childRegex.exec(content)) !== null) {
      sections.push({ id: match[1]!, start: match.index, level: 3, title: match[2]?.trim() });
    }

    // Sort by position in document
    sections.sort((a, b) => a.start - b.start);
  } else {
    // Flat: all h2/h3 with IDs are children
    const flatRegex = /^#{2,3}\s+(?:\[)?([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?)\]?\s*[:\s]\s*(.*)/gm;
    let match: RegExpExecArray | null;
    while ((match = flatRegex.exec(content)) !== null) {
      sections.push({ id: match[1]!, start: match.index, level: 3, title: match[2]?.trim() });
    }
  }

  // Track current parent for child assignment
  let currentParentId: string | undefined;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const end = i + 1 < sections.length ? sections[i + 1]!.start : content.length;
    const body = content.slice(section.start, end);

    const isParent = hasParents && section.level === 2;

    // Update current parent tracking
    if (isParent) {
      currentParentId = section.id;
    } else if (hasParents && section.level === 2) {
      currentParentId = undefined;
    }

    // Integration target (parent-only field)
    const integrationMatch = body.match(/\*\*(?:Integration[_ ]target|통합[_ ]대상)\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i);
    const integrationTarget = isParent ? (integrationMatch?.[1]?.trim() || undefined) : undefined;

    // Size: XS, S, or M (from heading or Size field)
    const sizeFromHeading = body.match(/\((?:Size:\s*)?(XS|S|M)\)/i);
    const sizeFromField = body.match(/\*\*Size\*\*:\s*(XS|S|M)/i);
    const size = (sizeFromHeading?.[1] ?? sizeFromField?.[1])?.toUpperCase() as WBSize | undefined;

    const depsMatch = body.match(/\*{0,2}(?:Prerequisite|depends_on|선행.?작업|블로커)\*{0,2}\s*:\s*(.+)/i);
    const dependsOn: string[] = [];
    if (depsMatch) {
      const depIds = depsMatch[1]!.match(/[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?/g);
      if (depIds) dependsOn.push(...depIds);
    }

    const targetFiles: string[] = [];
    const fileRegex = /`([^`]+\.[a-z]{1,5})`/g;
    // Support both "First touch files" and "Target Files" labels
    const fileFieldStart = body.search(/(?:First touch files|\*\*Target Files?\*\*)\s*:?/i);
    if (fileFieldStart !== -1) {
      const nextSection = body.indexOf("\n- **", fileFieldStart + 1);
      const nextHeading = body.indexOf("\n##", fileFieldStart + 1);
      const nextBlank = body.indexOf("\n\n", fileFieldStart + 1);
      const ends = [nextSection, nextHeading, nextBlank].filter(i => i > fileFieldStart);
      const end = ends.length > 0 ? Math.min(...ends) : Math.min(fileFieldStart + 500, body.length);
      const fileBlock = body.slice(fileFieldStart, end);
      let fileMatch: RegExpExecArray | null;
      while ((fileMatch = fileRegex.exec(fileBlock)) !== null) {
        targetFiles.push(fileMatch[1]!);
      }
    }

    // Action: concrete steps (multi-line until next field)
    const actionMatch = body.match(/\*\*Action\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i);
    const action = actionMatch?.[1]?.trim() || undefined;

    // Context budget: Read / Skip lists
    const ctxMatch = body.match(/\*\*Context budget\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*(?!Read|Skip)|\n##|$)/i);
    const ctxBlock = ctxMatch?.[1] ?? "";
    const readFiles: string[] = [];
    const skipFiles: string[] = [];
    const readMatch = ctxBlock.match(/Read:\s*(.+)/i);
    if (readMatch) {
      let fm: RegExpExecArray | null;
      while ((fm = fileRegex.exec(readMatch[1]!)) !== null) readFiles.push(fm[1]!);
    }
    const skipMatch = ctxBlock.match(/Skip:\s*(.+)/i);
    if (skipMatch) skipFiles.push(...skipMatch[1]!.split(/[,;]/).map(s => s.replace(/`/g, "").trim()).filter(Boolean));
    const contextBudget = (readFiles.length > 0 || skipFiles.length > 0)
      ? { read: readFiles, skip: skipFiles } : undefined;

    // Verify: runnable command
    const verifyMatch = body.match(/\*\*Verify\*\*:\s*`([^`]+)`/i)
      ?? body.match(/\*\*Verify\*\*:\s*(.+)/i);
    const verify = verifyMatch?.[1]?.trim() || undefined;

    // Constraints: scope boundaries
    const constraintsMatch = body.match(/\*\*Constraints?\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|$)/i);
    const constraints = constraintsMatch?.[1]?.trim() || undefined;

    // Done: completion criteria (stop at next field, section separator, or heading)
    const doneMatch = body.match(/\*\*Done\*\*:\s*([\s\S]*?)(?=\n-\s+\*\*|\n##|\n---|\n\n|$)/i);
    const done = doneMatch?.[1]?.trim().replace(/\n---$/, "").trim() || undefined;

    // Title: extract from heading (e.g., "### OIN-1: Project Scaffolding (Size: S)")
    const titleMatch = body.match(/^#{2,3}\s+[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Za-z]?[:\s]+(.+?)(?:\s*\((?:Size:)?\s*(?:XS|S|M)\))?$/m);
    const title = titleMatch?.[1]?.trim() || undefined;

    items.push({
      id: section.id,
      title,
      targetFiles,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      size,
      action,
      contextBudget,
      verify,
      constraints,
      done,
      ...(isParent ? { isParent: true, integrationTarget } : {}),
      ...(hasParents && !isParent && currentParentId ? { parentId: currentParentId } : {}),
    });
  }

  return items;
}

// ── Plan Review Gate ─────────────────────────

export interface PlanReviewResult {
  passed: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Structural validation of WBs before execution.
 * Ensures each item has the required fields for sub-agent single-pass completion.
 */
export function reviewPlan(items: WorkItem[]): PlanReviewResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (items.length === 0) {
    errors.push("No work items found");
    return { passed: false, warnings, errors };
  }

  // Separate parents and children for hierarchy validation
  const parents = items.filter(i => i.isParent);
  const children = items.filter(i => !i.isParent);
  const hasHierarchy = parents.length > 0;

  for (const item of items) {
    const prefix = `[${item.id}]`;

    // Parent-specific validation
    if (item.isParent) {
      // Parents should NOT have targetFiles (feature-level, not code-level)
      if (item.targetFiles.length > 0) {
        warnings.push(`${prefix} Parent has target files — parents are feature-level, not code-level`);
      }

      // Parents don't need Action/Verify (children have them)
      continue;
    }

    // Child-specific validation (and flat items)

    // Required: target files
    if (item.targetFiles.length === 0) {
      warnings.push(`${prefix} No target files — agent must discover targets`);
    }

    // Required: action (the whole point of the schema change)
    if (!item.action) {
      errors.push(`${prefix} Missing Action — sub-agent cannot execute without concrete steps`);
    }

    // Required: verify command
    if (!item.verify) {
      errors.push(`${prefix} Missing Verify — no way to confirm completion`);
    } else if (!/[a-z]/.test(item.verify) || item.verify.length < 5) {
      warnings.push(`${prefix} Verify looks too short — should be a runnable command`);
    } else {
      // Warn if Verify is type-check only (tsc without test runner)
      const hasTestRunner = /\b(vitest|jest|mocha|pytest|cargo\s+test|go\s+test|npm\s+test|node\s+--test)\b/i.test(item.verify);
      const isTscOnly = /\btsc\b/.test(item.verify) && !hasTestRunner;
      if (isTscOnly) {
        warnings.push(`${prefix} Verify is tsc-only — type checks miss runtime bugs. Add test runner command.`);
      }
    }

    // Recommended: constraints
    if (!item.constraints) {
      warnings.push(`${prefix} No Constraints — scope boundary unspecified`);
    }

    // Recommended: size
    if (!item.size) {
      warnings.push(`${prefix} No Size — model tier routing will use default`);
    }

    // Guard: too many target files suggests WB is too large
    if (item.targetFiles.length > 5) {
      errors.push(`${prefix} ${item.targetFiles.length} target files — split this WB`);
    }
  }

  // Hierarchy validation
  if (hasHierarchy) {
    const childrenByParent = new Map<string, WorkItem[]>();
    for (const child of children) {
      if (child.parentId) {
        const list = childrenByParent.get(child.parentId) ?? [];
        list.push(child);
        childrenByParent.set(child.parentId, list);
      }
    }

    for (const parent of parents) {
      const kids = childrenByParent.get(parent.id) ?? [];
      if (kids.length === 0) {
        errors.push(`[${parent.id}] Parent has no children — each parent must have at least one child`);
      } else {
        // Check if last child has integration/verification in title
        const lastChild = kids[kids.length - 1]!;
        const integrationKeywords = /integrat|verif|검증|통합/i;
        if (!integrationKeywords.test(lastChild.title ?? "") && !integrationKeywords.test(lastChild.id)) {
          warnings.push(`[${parent.id}] Last child ${lastChild.id} does not appear to be integration/verification`);
        }
      }
    }
  }

  // Cross-item: check for dependency on non-existent items
  // GATE-N references are resolved to Phase parent IDs (Phase gates enforce sequential execution)
  const ids = new Set(items.map(i => i.id));
  const parentIds = new Set(items.filter(i => i.isParent).map(i => i.id));
  const parentList = items.filter(i => i.isParent);

  for (const item of items) {
    for (const dep of item.dependsOn ?? []) {
      if (ids.has(dep)) continue; // Direct WB reference — valid

      // GATE-N → resolve to Phase parent at index N
      const gateMatch = dep.match(/^GATE-(\d+)$/);
      if (gateMatch) {
        const gateIdx = parseInt(gateMatch[1]!, 10);
        if (gateIdx < parentList.length) continue; // Valid gate reference
        errors.push(`[${item.id}] depends on ${dep} — gate index ${gateIdx} exceeds ${parentList.length} phases`);
      } else {
        // Unknown external reference — flag but don't block
        warnings.push(`[${item.id}] depends on ${dep} (unresolved external reference)`);
      }
    }
  }

  return { passed: errors.length === 0, warnings, errors };
}

// ── Wave-based Execution Grouping ─────────────────────
// Waves group WBs by dependency depth within phase boundaries.
// Phase parents create gate boundaries: Phase N must complete before Phase N+1 starts.
// Within a phase, topological sort by dependsOn creates sub-waves.
// Items in the same wave can run in parallel (up to concurrency limit).

export interface Wave {
  /** Wave index (0-based, global across all phases) */
  index: number;
  /** Phase parent ID (e.g., "Phase-0") or null for orphans */
  phaseId: string | null;
  /** Items in this wave — can run in parallel */
  items: WorkItem[];
}

/**
 * Compute execution waves from work items.
 * Uses phase hierarchy + dependsOn for topological ordering.
 */
export function computeWaves(items: WorkItem[]): Wave[] {
  const parents = items.filter(i => i.isParent);
  const children = items.filter(i => !i.isParent);
  const waves: Wave[] = [];
  let waveIdx = 0;

  if (parents.length === 0) {
    // No hierarchy — pure topological sort
    for (const group of topologicalWaves(children)) {
      waves.push({ index: waveIdx++, phaseId: null, items: group });
    }
    return waves;
  }

  // Group children by parent
  const childrenByParent = new Map<string, WorkItem[]>();
  const orphans: WorkItem[] = [];
  for (const c of children) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    } else {
      orphans.push(c);
    }
  }

  // Process phases in order — each phase is a gate boundary
  for (const parent of parents) {
    const kids = childrenByParent.get(parent.id) ?? [];
    if (kids.length === 0) continue;

    const phaseWaves = topologicalWaves(kids);
    for (const group of phaseWaves) {
      waves.push({ index: waveIdx++, phaseId: parent.id, items: group });
    }
  }

  // Orphans (no parent) go last
  if (orphans.length > 0) {
    waves.push({ index: waveIdx++, phaseId: null, items: orphans });
  }

  return waves;
}

/** Topological sort by dependsOn depth. Items at the same depth form a wave. */
function topologicalWaves(items: WorkItem[]): WorkItem[][] {
  const ids = new Set(items.map(i => i.id));
  const waves: WorkItem[][] = [];
  const placed = new Set<string>();

  while (placed.size < items.length) {
    const wave: WorkItem[] = [];
    for (const item of items) {
      if (placed.has(item.id)) continue;
      // Ready if all deps are placed or not in this group (external dep = already done)
      const ready = (item.dependsOn ?? []).every(dep => placed.has(dep) || !ids.has(dep));
      if (ready) wave.push(item);
    }
    if (wave.length === 0) {
      // Circular or unresolved deps — force remaining into one wave
      waves.push(items.filter(i => !placed.has(i.id)));
      break;
    }
    for (const item of wave) placed.add(item.id);
    waves.push(wave);
  }

  return waves;
}

// ── Design Document Verification ──────────────────────

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
