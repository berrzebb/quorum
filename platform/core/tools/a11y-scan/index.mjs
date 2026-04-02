/**
 * a11y-scan/index.mjs — Tool: a11y_scan
 *
 * Scan JSX/TSX files for accessibility anti-patterns.
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { runPatternScan, walkDir } from "../tool-utils.mjs";

// ═══ Accessibility patterns ═════════════════════════════════════════════

const A11Y_PATTERNS = [
  { re: /<img\s+(?![^>]*alt\s*=)/m, label: "img-no-alt", severity: "high", msg: "<img> missing alt attribute" },
  { re: /<(?!button\b)\w+\s+onClick/m, label: "click-no-keyboard", severity: "medium", msg: "Non-button element with onClick — add keyboard handler or use <button>" },
  { re: /<div\s+onClick/m, label: "div-click", severity: "medium", msg: "<div> with onClick — use <button> or add role" },
  { re: /<(?:input|textarea|select)\s+(?![^>]*(?:aria-label|aria-labelledby|id\s*=))/m, label: "form-no-label", severity: "high", msg: "Form element missing label association" },
  { re: /tabIndex\s*=\s*\{?\s*-1/m, label: "negative-tabindex", severity: "low", msg: "Negative tabIndex removes from tab order" },
  { re: /aria-hidden\s*=\s*["']true["'][\s\S]{0,50}onClick/m, label: "hidden-interactive", severity: "high", msg: "aria-hidden on interactive element" },
  { re: /<a\s+(?![^>]*href)/m, label: "anchor-no-href", severity: "medium", msg: "<a> without href — not keyboard accessible" },
  { re: /style\s*=\s*\{\s*\{[^}]*display\s*:\s*["']?none/m, label: "css-hidden", severity: "low", msg: "CSS display:none — verify not hiding from assistive tech" },
];

// ═══ Tool: a11y_scan ════════════════════════════════════════════════════

/**
 * Scan JSX/TSX files for accessibility anti-patterns:
 * missing alt, missing aria-label, onClick without keyboard, no role, etc.
 */
export function toolA11yScan(params) {
  // Pre-check: skip if no JSX/TSX files exist
  const cwd = process.cwd();
  const target = resolve(params.path || cwd);
  const stat_ = statSync(target, { throwIfNoEntry: false });
  if (!stat_) return { error: `Not found: ${target}` };
  const jsxExt = new Set([".tsx", ".jsx"]);
  const jsxFiles = stat_.isDirectory() ? walkDir(target, jsxExt, 5) : [target];
  if (jsxFiles.length === 0) {
    return { text: "a11y_scan: skip — no JSX/TSX files found.", summary: "0 JSX files" };
  }

  return runPatternScan({
    targetPath: params.path,
    extensions: jsxExt,
    patterns: A11Y_PATTERNS,
    toolName: "a11y_scan",
    heading: "Accessibility Scan Results",
    passMsg: "no accessibility issues detected",
    failNoun: "critical a11y violation(s)",
  });
}
