/**
 * Shared trigger evaluation runner — evidence validation, trigger scoring, domain routing.
 *
 * Extracted from adapters/claude-code/index.mjs (the PostToolUse handler).
 * This is the core audit pipeline logic that determines what happens when
 * evidence is submitted to the watch file.
 *
 * All functions return data — no stdout/stdin, no spawn, no I/O.
 * Callers (adapter hooks) handle I/O and formatting.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/** Cached required-section patterns (stable within session). */
let _requiredCache = null;
let _requiredCacheKey = null;

/**
 * Pre-validate evidence package format — regex-based, zero tokens.
 *
 * @param {string} content — full watch file content
 * @param {object} consensus — consensus config section
 * @param {Function} [t] — i18n function (optional, defaults to identity)
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEvidenceFormat(content, consensus, t = (k) => k) {
  const errors = [];
  const warnings = [];
  const triggerTag = consensus.trigger_tag ?? "[REVIEW_NEEDED]";
  const agreeTag = consensus.agree_tag ?? "[APPROVED]";

  const triggerSection = content.split(/^## /m).find((s) => s.includes(triggerTag));
  if (!triggerSection) return { errors, warnings };

  // Required sections — configurable (cached per config)
  const configSections = consensus.evidence_sections ?? [];
  const defaultSections = ["Claim", "Changed Files", "Test Command", "Test Result", "Residual Risk"];
  const sectionNames = configSections.length > 0 ? configSections : defaultSections;
  const cacheKey = sectionNames.join("|");
  if (!_requiredCache || _requiredCacheKey !== cacheKey) {
    _requiredCacheKey = cacheKey;
    _requiredCache = sectionNames.map((label) => ({
      label,
      pattern: new RegExp(`### ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
    }));
  }
  const required = _requiredCache;

  for (const { label, pattern } of required) {
    if (!pattern.test(triggerSection)) {
      errors.push(typeof t === "function" ? t("index.format.missing_section", { label }) : `Missing section: ${label}`);
    }
  }

  // Test Command glob ban
  if (/### Test Command/.test(triggerSection)) {
    const cmdSection = triggerSection.split(/### Test Command/i)[1]?.split(/### /)[0] || "";
    if (/\*\*?\/|\*\.\w+/.test(cmdSection)) {
      errors.push(typeof t === "function" ? t("index.format.glob_in_test") : "Glob pattern in test command");
    }
  }

  // Test Result not empty
  if (/### Test Result/.test(triggerSection)) {
    const resultSection = triggerSection.split(/### Test Result/i)[1]?.split(/### /)[0] || "";
    if (resultSection.trim().length < 10) {
      errors.push(typeof t === "function" ? t("index.format.empty_result") : "Empty test result");
    }
  }

  // Changed Files existence check
  if (/### Changed Files/.test(triggerSection)) {
    const filesSection = triggerSection.split(/### Changed Files/i)[1]?.split(/### /)[0] || "";
    const listedFiles = [...filesSection.matchAll(/`([^`]+\.[a-zA-Z]+)`/g)].map((m) => m[1]);
    // Note: file existence checks need repoRoot — caller can add these warnings
    if (listedFiles.length === 0 && filesSection.trim().length > 0) {
      warnings.push(typeof t === "function" ? t("index.quick_audit.no_backtick_paths") : "No backtick-delimited file paths found");
    }
  }

  // Tag conflict check
  const lines = triggerSection.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes(triggerTag) && line.includes(agreeTag)) {
      warnings.push(typeof t === "function"
        ? t("index.quick_audit.tag_conflict", { trigger: triggerTag, agree: agreeTag })
        : `Tag conflict: ${triggerTag} and ${agreeTag} on same line`);
    }
  }

  return { errors, warnings };
}

/**
 * Parse changed files from evidence content.
 *
 * @param {string} content — watch file content (or just the Changed Files section)
 * @returns {string[]} Array of relative file paths
 */
export function parseChangedFiles(content) {
  const section = content.match(/### Changed Files[\s\S]*?(?=###|$)/)?.[0] ?? "";
  return (section.match(/^- `([^`]+)`/gm) ?? [])
    .map(m => m.replace(/^- `|`$/g, ""));
}

/**
 * Count changed files from evidence content.
 *
 * @param {string} content — watch file content
 * @returns {number}
 */
export function countChangedFiles(content) {
  const section = content.match(/### Changed Files[\s\S]*?(?=###|$)/)?.[0] ?? "";
  return (section.match(/^- `/gm) ?? []).length;
}

/**
 * Check if changed files actually exist on disk.
 *
 * @param {string[]} files — relative file paths
 * @param {string} repoRoot — absolute repo root
 * @returns {{ existing: string[], missing: string[] }}
 */
export function verifyChangedFiles(files, repoRoot) {
  const existing = [];
  const missing = [];
  for (const f of files) {
    if (existsSync(resolve(repoRoot, f))) {
      existing.push(f);
    } else {
      missing.push(f);
    }
  }
  return { existing, missing };
}

/**
 * Check if git diff matches the listed changed files.
 *
 * @param {string[]} listedFiles — files listed in evidence
 * @param {string} repoRoot — absolute repo root
 * @returns {{ notInDiff: string[] }} Files listed in evidence but not in git diff
 */
export function crossCheckGitDiff(listedFiles, repoRoot) {
  const notInDiff = [];
  try {
    let diffFiles = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: repoRoot, encoding: "utf8", windowsHide: true,
    }).trim().split("\n").filter(Boolean);

    if (diffFiles.length === 0) {
      diffFiles = execFileSync("git", ["diff", "--name-only"], {
        cwd: repoRoot, encoding: "utf8", windowsHide: true,
      }).trim().split("\n").filter(Boolean);
    }

    if (diffFiles.length > 0) {
      for (const f of listedFiles) {
        if (!diffFiles.some((d) => d.endsWith(f) || f.endsWith(d))) {
          notInDiff.push(f);
        }
      }
    }
  } catch (err) { console.warn(`[trigger-runner] git diff cross-check failed: ${err?.message}`); }
  return { notInDiff };
}

/**
 * Build trigger evaluation context from evidence content.
 * This creates the context object that bridge.gate.evaluateTrigger() expects.
 *
 * @param {object} params
 * @param {string} params.content — watch file content
 * @param {string[]} params.changedFiles — parsed changed file paths
 * @param {number} params.changedFileCount — number of changed files
 * @param {object} [params.detectionResult] — domain detection result from bridge
 * @param {number} [params.priorRejections=0] — count of prior rejection verdicts
 * @param {boolean} [params.hasPlanDoc=false] — whether plan docs exist
 * @param {number} [params.blastRadius] — blast radius ratio (0.0-1.0)
 * @returns {object} TriggerContext for bridge.gate.evaluateTrigger()
 */
export function buildTriggerContext({
  content,
  changedFiles,
  changedFileCount,
  detectionResult,
  priorRejections = 0,
  hasPlanDoc = false,
  blastRadius,
}) {
  const changedFileSection = content.match(/### Changed Files[\s\S]*?(?=###|$)/)?.[0] ?? "";

  return {
    changedFiles: changedFileCount || 1,
    securitySensitive: /auth|token|secret|crypt/i.test(changedFileSection),
    priorRejections,
    apiSurfaceChanged: /api|endpoint|route/i.test(changedFileSection),
    crossLayerChange: changedFileSection.includes("src/") && changedFileSection.includes("tests/"),
    isRevert: /revert|rollback/i.test(content),
    domains: detectionResult?.domains,
    hasPlanDoc,
    blastRadius,
  };
}

/**
 * Check if plan docs exist in common locations.
 *
 * @param {string} repoRoot — absolute repo root
 * @returns {boolean}
 */
export function hasPlanDocuments(repoRoot) {
  const planDirs = ["docs/plan", "docs/plans", "plans"];
  return planDirs.some(d => {
    try { return existsSync(resolve(repoRoot, d)); } catch (err) { console.warn(`[trigger-runner] plan doc check failed: ${err?.message}`); return false; }
  });
}

/**
 * Check if a file path matches planning file patterns.
 *
 * @param {string} normalizedPath — forward-slash normalized path
 * @param {object} consensus — consensus config section
 * @returns {boolean}
 */
export function isPlanningFile(normalizedPath, consensus) {
  const files = consensus.planning_files ?? [];
  const dirs = consensus.planning_dirs ?? [];
  return files.some((f) => normalizedPath.endsWith(f.replace(/\\/g, "/")))
    || dirs.some((d) => normalizedPath.includes(d.replace(/\\/g, "/")));
}
