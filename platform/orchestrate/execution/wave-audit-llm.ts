/**
 * Wave-level LLM audit — spawns a provider CLI to review wave changes.
 *
 * Single-turn `provider -p` invocation with structured JSON verdict output.
 * No mechanical gates, no fixer logic — pure LLM review.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** At runtime: dist/platform/orchestrate/execution/ → up 2 → dist/platform/ */
const DIST = resolve(__dirname, "..", "..");

interface WorkItemLike {
  id: string;
  title?: string;
}

/**
 * Run a single LLM audit for all changes in a wave.
 * Uses `provider -p` with auditor instructions to review the wave's files.
 */
export async function runWaveAuditLLM(
  repoRoot: string, files: string[], items: WorkItemLike[], provider: string,
): Promise<{ passed: boolean; findings: string[] }> {

  // DIST = dist/platform/, up 2 = project root
  const quorumRoot = resolve(DIST, "..", "..");
  const { resolveBinary } = await import(pathToFileURL(resolve(quorumRoot, "platform", "core", "cli-runner.mjs")).href);
  const bin = resolveBinary(provider);

  const fileList = [...new Set(files)].slice(0, 20).map(f => `- ${f}`).join("\n");
  const itemList = items.map((i: any) => `- ${i.id}: ${i.title ?? "(no title)"}`).join("\n");

  const prompt = [
    "# Wave Audit — Review Implementation Changes",
    "",
    `## Items completed in this wave:`,
    itemList,
    "",
    `## Files to review:`,
    fileList,
    "",
    "## Instructions:",
    "1. Read each file listed above",
    "2. Check: does the code compile? Are types correct? Are there obvious bugs?",
    "3. Run the verify commands from the work breakdown if available",
    "4. Run existing tests — if any fail, flag as finding",
    "5. **Substantiveness check** — for EACH file, verify:",
    "   a. NO stub indicators: TODO, FIXME, placeholder, 'not implemented', empty function bodies",
    "   b. NO hardcoded mock data where real logic is expected (return [], return null, return {})",
    "   c. Functions have REAL logic, not just type signatures or pass-through",
    "   d. Event handlers do actual work, not just console.log",
    "   e. API calls return real data flows, not static fixtures",
    "   If ANY stub is found, output passed: false with the specific stub location.",
    "6. Output a JSON verdict at the END of your response in this exact format:",
    '```json',
    '{"passed": true|false, "findings": ["issue 1", "issue 2"]}',
    '```',
    "",
    "FAIL if: type errors, obvious bugs, regressions, OR stub/placeholder code.",
    "Stubs are NOT acceptable — every function must have real implementation.",
  ].join("\n");

  const result = spawnSync(bin, ["-p", prompt, "--dangerously-skip-permissions"], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
    timeout: 180_000,
    encoding: "utf8",
  });

  const output = (result.stdout ?? "") as string;

  // Parse verdict from output
  const jsonMatch = output.match(/```json\s*\n({[\s\S]*?})\s*\n```/);
  if (jsonMatch) {
    try {
      const verdict = JSON.parse(jsonMatch[1]!);
      return {
        passed: !!verdict.passed,
        findings: Array.isArray(verdict.findings) ? verdict.findings : [],
      };
    } catch { /* fall through */ }
  }

  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes('"passed": true') || lowerOutput.includes("all items are correctly")) {
    return { passed: true, findings: [] };
  }

  return { passed: false, findings: ["Audit returned unstructured output — manual review needed"] };
}
