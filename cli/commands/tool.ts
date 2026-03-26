/**
 * quorum tool <name> — run MCP analysis tools from CLI.
 *
 * Delegates to core/tools/tool-runner.mjs which already supports
 * all 19+ tools: code_map, dependency_graph, audit_scan, coverage_map,
 * rtm_parse, rtm_merge, audit_history, fvm_generate, fvm_validate,
 * perf_scan, a11y_scan, license_scan, i18n_validate, infra_scan,
 * observability_check, doc_coverage, compat_check, blast_radius,
 * ai_guide, blueprint_lint
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function run(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(`
\x1b[36mquorum tool\x1b[0m — run MCP analysis tools

\x1b[1mUsage:\x1b[0m quorum tool <name> [--param value ...]

\x1b[1mCore Tools:\x1b[0m
  code_map             Symbol index (functions, classes, types)
  dependency_graph     Import/export DAG, topological sort
  blast_radius         Transitive impact of changed files (BFS)
  audit_scan           Pattern scanner (type-safety, hardcoded)
  coverage_map         Per-file coverage from vitest JSON
  audit_history        Query audit verdicts and patterns
  ai_guide             Context-aware onboarding guide

\x1b[1mRTM & Verification:\x1b[0m
  rtm_parse            Parse RTM markdown → structured rows
  rtm_merge            Row-level merge with conflict detection
  fvm_generate         FE route × API × BE endpoint matrix
  fvm_validate         Execute FVM rows against live server

\x1b[1mDomain Specialists:\x1b[0m
  perf_scan            Performance anti-patterns (hybrid: regex+AST)
  compat_check         API breaking changes
  a11y_scan            Accessibility (JSX/TSX)
  license_scan         License compliance + PII
  i18n_validate        Locale key parity
  infra_scan           Dockerfile/CI security
  observability_check  Empty catch, logging gaps
  doc_coverage         JSDoc coverage %
  blueprint_lint       Naming convention enforcement

\x1b[1mExample:\x1b[0m
  quorum tool code_map src/
  quorum tool blast_radius --changed_files '["src/api.ts"]'
  quorum tool perf_scan src/
`);
    return;
  }

  // __dirname = dist/cli/commands/ → 3 levels up to package root → core/tools/
  const toolRunner = resolve(__dirname, "..", "..", "..", "core", "tools", "tool-runner.mjs");

  // If second arg exists and doesn't start with --, treat it as --path shorthand
  // e.g., "quorum tool code_map src/" → "node tool-runner.mjs code_map --path src/"
  const toolArgs = [...args];
  if (toolArgs.length >= 2 && !toolArgs[1]!.startsWith("--")) {
    toolArgs.splice(1, 0, "--path");
  }

  const result = spawnSync(process.execPath, [toolRunner, ...toolArgs], {
    stdio: "inherit",
    cwd: process.cwd(),
    windowsHide: true,
  });

  process.exit(result.status ?? 1);
}
