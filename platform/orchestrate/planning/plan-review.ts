/**
 * Plan Review Gate — structural validation of WBs before execution.
 *
 * Extracted from cli/commands/orchestrate/shared.ts.
 * Pure function: takes items array, returns review result.
 */

import type { WorkItem, PlanReviewResult } from './types.js';

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
    // Threshold 10: Action block extraction adds referenced files beyond primary targets
    if (item.targetFiles.length > 10) {
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
