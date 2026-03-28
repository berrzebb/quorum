import { existsSync, readFileSync } from "node:fs";
import {
  SEC, t, escapeRe, cfg,
  triggerInner, pendingInner,
  extractStatusFromLine, readSection,
} from "../context.mjs";

export function hasPendingItems(markdown) {
  return new RegExp(`\\[(${escapeRe(triggerInner)}|${escapeRe(pendingInner)})\\]`).test(markdown);
}

export function detectScope(markdown) {
  const result = readSection(markdown, SEC.auditScope);
  const section = result
    ? result.lines.slice(1) // skip the heading line itself
    : markdown.split(/\r?\n/);

  const normalized = section
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  const pending = normalized.filter((line) => extractStatusFromLine(line) === triggerInner);
  if (pending.length > 0) {
    return pending.map((line) => line.replace(/^- /, "")).join("\n");
  }

  const fallback = normalized.filter((line) => extractStatusFromLine(line) === pendingInner);
  if (fallback.length > 0) {
    return fallback.map((line) => line.replace(/^- /, "")).join("\n");
  }

  return t("audit.scope.fallback", { file: "evidence (SQLite)" });
}

export function readSectionLines(markdown, heading) {
  const section = readSection(markdown, heading);
  return section ? section.lines.slice(1) : [];
}

export function loadPromotionHint(promotionDocPaths) {
  for (const docPath of promotionDocPaths) {
    if (!existsSync(docPath)) {
      continue;
    }

    const markdown = readFileSync(docPath, "utf8");
    const lines = readSectionLines(markdown, SEC.promotionTarget).concat(readSectionLines(markdown, "Current Promotion Target"));
    const firstBullet = lines
      .map((line) => line.trim())
      .find((line) => line.startsWith("- "));

    if (firstBullet) {
      return {
        docPath,
        nextTask: firstBullet.replace(/^- /, "").trim(),
      };
    }
  }

  return null;
}

export function buildPromotionSection(promotionHint) {
  if (!promotionHint) return "";
  return t("audit.promotion.agree_label", {
    agree_tag:         cfg.consensus.agree_tag,
    source:            promotionHint.docPath.replace(/\\/g, "/"),
    next_task:         promotionHint.nextTask,
    next_task_section: SEC.nextTask,
  });
}

/**
 * Compare the "changed files" list in trigger_tag blocks against the eslint scope in "Test Command".
 * Returns warnings for any test file present in changed files but missing from the eslint command.
 */
export function checkEslintCoverage(markdown) {
  const warnings = [];
  const h2Blocks = markdown.split(/(?=^## )/m);

  for (const block of h2Blocks) {
    if (!block.includes(cfg.consensus.trigger_tag)) continue;

    const headingMatch = block.match(/^## (.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : "(unknown)";

    // Extract paths from the "changed files" section
    const changedFilesMatch = block.match(new RegExp(`### ${escapeRe(SEC.changedFiles)}\\n([\\s\\S]*?)(?=\\n###|\\n---|\\n## |$)`));
    const changedFiles = changedFilesMatch
      ? [...changedFilesMatch[1].matchAll(/- `([^`]+)`/g)].map((m) => m[1])
      : [];

    // Extract the eslint line from the "Test Command" section
    const testCmdMatch = block.match(/### Test Command\n[\s\S]*?```[^\n]*\n([\s\S]*?)```/);
    const eslintLine = testCmdMatch
      ? (testCmdMatch[1].split("\n").find((l) => /npx eslint/.test(l)) ?? "")
      : "";

    const eslintTokens = eslintLine.split(/\s+/).filter((t) => t && !t.startsWith("-") && t !== "npx" && t !== "eslint");
    const eslintSet = new Set(eslintTokens);

    const missing = changedFiles.filter((f) => !eslintSet.has(f));
    if (missing.length > 0) {
      warnings.push({ heading, missing });
    }
  }

  return warnings;
}

/** Extract file paths from ### Changed Files section in evidence. */
export function extractChangedFilesFromEvidence(markdown) {
  const section = readSection(markdown, "Changed Files");
  if (!section) return [];
  return section.lines
    .map(line => line.match(/`([^`]+\.[a-zA-Z]+)`/))
    .filter(Boolean)
    .map(m => m[1]);
}

/** Extract test commands from ### Test Command section in evidence. */
export function extractTestCommands(markdown) {
  const section = readSection(markdown, "Test Command");
  if (!section) return [];
  return section.lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("```") && !l.startsWith("#") && !l.startsWith("//"))
    .filter(l => l.match(/^(npx|npm|node|vitest|jest|cargo|python|python3|py|ruff|go |make|pytest)/));
}
