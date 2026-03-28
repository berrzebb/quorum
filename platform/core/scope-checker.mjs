/**
 * Scope Checker — deterministic diff vs evidence comparison.
 *
 * Prevents scope-mismatch rejections by verifying that:
 * 1. Every file in git diff appears in the evidence's Changed Files
 * 2. Every file in evidence's Changed Files appears in git diff
 * 3. No undocumented changes exist
 *
 * Replaces LLM-based scope analysis with exact `git diff` comparison.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

/**
 * @param {string} evidencePath - Path to the evidence markdown file OR evidence content string
 * @param {string} repoRoot - Repository root
 * @param {string} [baseBranch] - Base branch for diff (default: HEAD~1)
 * @returns {{ match: boolean, missing: string[], extra: string[], diffFiles: string[], evidenceFiles: string[] }}
 */
export function checkScope(evidencePath, repoRoot, baseBranch) {
  const diffFiles = getDiffFiles(repoRoot, baseBranch);
  // Accept raw content string (primary) or file path (legacy fallback)
  const evidenceFiles = (typeof evidencePath === "string" && evidencePath.includes("\n"))
    ? parseEvidenceContent(evidencePath)
    : parseEvidenceFiles(evidencePath);

  const diffSet = new Set(diffFiles.map(normalize));
  const evidenceSet = new Set(evidenceFiles.map(normalize));

  // Files in diff but NOT in evidence (undocumented changes)
  const missing = diffFiles.filter(f => !evidenceSet.has(normalize(f)));

  // Files in evidence but NOT in diff (claimed but not changed)
  const extra = evidenceFiles.filter(f => !diffSet.has(normalize(f)));

  return {
    match: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    diffFiles,
    evidenceFiles,
  };
}

/**
 * Format scope check result for display.
 */
function formatScopeResult(result) {
  const lines = [];

  if (result.match) {
    lines.push("✓ Scope match: evidence matches diff exactly.");
    lines.push(`  ${result.diffFiles.length} file(s) in both diff and evidence.`);
  } else {
    lines.push("✗ Scope mismatch detected:");

    if (result.missing.length > 0) {
      lines.push("");
      lines.push("  Files in diff but NOT in evidence (undocumented):");
      for (const f of result.missing) lines.push(`    - ${f}`);
    }

    if (result.extra.length > 0) {
      lines.push("");
      lines.push("  Files in evidence but NOT in diff (claimed but unchanged):");
      for (const f of result.extra) lines.push(`    - ${f}`);
    }
  }

  return lines.join("\n");
}

// ── Git diff ──────────────────────────────────

function getDiffFiles(repoRoot, baseBranch) {
  const base = baseBranch || "HEAD~1";

  try {
    // Try range diff first
    const output = execFileSync("git", ["diff", "--name-only", base], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    // Fallback: staged + unstaged
    try {
      const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
        cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      }).trim();
      const unstaged = execFileSync("git", ["diff", "--name-only"], {
        cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      }).trim();
      const all = new Set([...staged.split("\n"), ...unstaged.split("\n")].filter(Boolean));
      return [...all];
    } catch {
      return [];
    }
  }
}

// ── Evidence parser ───────────────────────────

function parseEvidenceFiles(evidencePath) {
  // Legacy: accept file path string (no longer primary path — audit_submit sends content directly)
  if (!evidencePath || typeof evidencePath !== "string") return [];
  // If it looks like content (has newlines), parse directly
  if (evidencePath.includes("\n")) return parseEvidenceContent(evidencePath);
  return [];
}

function parseEvidenceContent(content) {
  const files = [];

  // Find "### Changed Files" section
  const section = content.match(/###\s*Changed Files[\s\S]*?(?=###|$)/i);
  if (!section) return [];

  const sectionText = section[0];

  // Extract file paths from bullet items: - `path/to/file.ts` — description
  const filePattern = /^[\s-]*`([^`]+)`/gm;
  let match;
  while ((match = filePattern.exec(sectionText)) !== null) {
    files.push(match[1]);
  }

  return files;
}

function normalize(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}
