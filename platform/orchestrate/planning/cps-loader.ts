/**
 * CPS (Context-Problem-Solution) loader — discovers and reads parliament CPS files.
 *
 * Also loads planner protocol (SKILL.md) for prompt construction.
 * Handles ONLY file discovery and reading — no prompt generation.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/** Parsed CPS content (raw markdown from the latest CPS file). */
export interface CPSContent {
  /** Raw markdown content of the CPS file */
  raw: string;
  /** Source file path */
  filePath: string;
}

/**
 * Find all CPS files in the parliament directory.
 * Files match pattern: `.claude/parliament/cps-*.md`
 * Returns paths sorted by name (chronological — filenames contain date).
 */
export function findCPSFiles(projectRoot: string): string[] {
  const cpsDir = resolve(projectRoot, ".claude", "parliament");
  if (!existsSync(cpsDir)) return [];

  return readdirSync(cpsDir)
    .filter(f => f.startsWith("cps-") && f.endsWith(".md"))
    .sort()
    .map(f => resolve(cpsDir, f));
}

/**
 * Load the latest CPS file content.
 * Returns null if no CPS files exist.
 */
export function loadCPS(projectRoot: string): CPSContent | null {
  const files = findCPSFiles(projectRoot);
  if (files.length === 0) return null;

  const filePath = files[files.length - 1]!;
  const raw = readFileSync(filePath, "utf8");
  return { raw, filePath };
}

/**
 * Load the planner protocol (SKILL.md).
 * Returns empty string if not found.
 */
export function loadPlannerProtocol(projectRoot: string): string {
  const skillPath = resolve(projectRoot, "platform", "skills", "planner", "SKILL.md");
  if (existsSync(skillPath)) return readFileSync(skillPath, "utf8");
  return "";
}
