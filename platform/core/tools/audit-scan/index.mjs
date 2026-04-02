/**
 * audit-scan/index.mjs — Tool: audit_scan
 *
 * Pattern scanner (type-safety, hardcoded, console, etc.)
 * Extracted from tool-core.mjs (SPLIT-2).
 */
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { safePathOrError } from "../tool-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══ Tool: audit_scan ═══════════════════════════════════════════════════

export function toolAuditScan(params) {
  const { pattern = "all", path: targetPath } = params;
  if (targetPath) { const c = safePathOrError(targetPath); if (c.error) return c; }
  const scriptPath = resolve(__dirname, "..", "audit-scan.mjs");
  if (!existsSync(scriptPath)) return { error: "audit-scan.mjs not found" };

  try {
    const args = [scriptPath, pattern];
    if (targetPath) args.push(targetPath);
    const output = execFileSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30000,
      windowsHide: true,
    });
    return { text: output.trim() };
  } catch (err) {
    return { error: err.message, stdout: err.stdout?.trim() };
  }
}
