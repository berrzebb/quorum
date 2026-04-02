/**
 * contract-drift — Detect contract drift via AST program mode.
 * Extracted from tool-core.mjs (SPLIT-3).
 */
import { existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { safePathOrError } from "../tool-utils.mjs";

/**
 * Detect contract drift: type/interface re-declarations, signature mismatches,
 * and missing members between contract directories and implementations.
 *
 * Uses AST program mode (TypeScript Compiler API) for cross-file analysis.
 * Contract directories: paths containing /types/, /contracts/, /interfaces/
 * (or custom via contract_dirs parameter).
 */
export async function toolContractDrift(params) {
  const cwd = process.cwd();
  if (params.path) { const c = safePathOrError(params.path); if (c.error) return c; }
  const targetPath = params.path ? resolve(params.path) : cwd;

  // Find tsconfig.json
  let tsconfigPath = params.tsconfig;
  if (!tsconfigPath) {
    const candidates = [
      resolve(targetPath, "tsconfig.json"),
      resolve(cwd, "tsconfig.json"),
    ];
    tsconfigPath = candidates.find(c => existsSync(c));
  }

  if (!tsconfigPath || !existsSync(tsconfigPath)) {
    return { error: "tsconfig.json not found. contract_drift requires TypeScript program mode." };
  }

  // Load AST analyzer (program mode)
  let ASTAnalyzer;
  try {
    const astPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "dist", "platform", "providers", "ast-analyzer.js");
    const mod = await import(astPath);
    ASTAnalyzer = mod.ASTAnalyzer;
  } catch (err) {
    console.warn("[tool-core] AST analyzer import failed:", err?.message ?? err);
    try {
      // Fallback: try direct import
      const mod = await import("../../../../dist/platform/providers/ast-analyzer.js");
      ASTAnalyzer = mod.ASTAnalyzer;
    } catch (err2) {
      console.error("[tool-core] AST analyzer fallback also failed:", err2?.message ?? err2);
      return { error: "AST analyzer unavailable. Run: npm run build" };
    }
  }

  const analyzer = new ASTAnalyzer({ mode: "program" });
  if (!analyzer.initProgram(tsconfigPath)) {
    return { error: `Failed to initialize TypeScript program from ${tsconfigPath}` };
  }

  const contractDirs = params.contract_dirs
    ? params.contract_dirs.split(",").map(d => d.trim())
    : undefined;

  const drifts = analyzer.detectContractDrift(contractDirs);

  if (drifts.length === 0) {
    return {
      text: "## Contract Drift\n\n**0 issues** — all implementations match their contract definitions.",
      summary: "contract_drift: 0 issues (clean)",
      json: { total: 0, findings: [] },
    };
  }

  // Format findings table
  const criticalCount = drifts.filter(d => d.severity === "critical").length;
  const highCount = drifts.filter(d => d.severity === "high").length;

  const rows = drifts.map(d => {
    const relContract = relative(cwd, d.contractFile);
    const relViolation = relative(cwd, d.violationFile);
    return `| \`${d.contractName}\` | ${d.kind} | ${relViolation}:${d.violationLine} | ${d.severity} | ${d.detail} |`;
  });

  const text = [
    "## Contract Drift",
    "",
    `**${drifts.length} issue(s)** found — ${criticalCount} critical, ${highCount} high`,
    "",
    "| Contract | Kind | Violation | Severity | Detail |",
    "|----------|------|-----------|----------|--------|",
    ...rows,
    "",
    "### Resolution",
    "",
    "- **redeclaration**: Delete the duplicate and import from the contract file instead",
    "- **signature-mismatch**: Update implementation to match the contract signature",
    "- **missing-member**: Implement the missing member as defined in the contract",
  ].join("\n");

  return {
    text,
    summary: `contract_drift: ${drifts.length} issue(s) (${criticalCount} critical)`,
    json: { total: drifts.length, critical: criticalCount, high: highCount, findings: drifts },
  };
}
