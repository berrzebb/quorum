/**
 * Wave-level LLM audit — spawns a provider CLI to review wave changes.
 *
 * Uses buildProviderArgs for provider-aware CLI invocation (claude/codex/gemini).
 * No mechanical gates, no fixer logic — pure LLM review.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderArgs, resolveProviderBinary } from "../core/provider-binary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** At runtime: dist/platform/orchestrate/execution/ → up 2 → dist/platform/ */
const DIST = resolve(__dirname, "..", "..");

interface WorkItemLike {
  id: string;
  title?: string;
}

/**
 * Run a single LLM audit for all changes in a wave.
 * Uses provider-aware CLI args (claude -p / codex exec / gemini).
 */
export async function runWaveAuditLLM(
  repoRoot: string, files: string[], items: WorkItemLike[], provider: string,
): Promise<{ passed: boolean; findings: string[] }> {

  const bin = await resolveProviderBinary(provider);

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
    "You MAY read files to review code. Do NOT run build/test/lint commands (npm test, tsc, eslint, etc).",
    "Build verification is already handled by the orchestrator. Your role is code quality review.",
    "",
    "1. Read each file listed above",
    "2. Check: are types correct? Are there obvious bugs or logic errors?",
    "3. Check: is error handling appropriate? Are edge cases considered?",
    "4. **Substantiveness check** — for EACH file, verify:",
    "   a. NO stub indicators: TODO, FIXME, placeholder, 'not implemented', empty function bodies",
    "   b. NO hardcoded mock data where real logic is expected (return [], return null, return {})",
    "   c. Functions have REAL logic, not just type signatures or pass-through",
    "   d. Event handlers do actual work, not just console.log",
    "   e. API calls return real data flows, not static fixtures",
    "   If ANY stub is found, output passed: false with the specific stub location.",
    "5. Output a JSON verdict at the END of your response in this exact format:",
    '```json',
    '{"passed": true|false, "findings": ["issue 1", "issue 2"]}',
    '```',
    "",
    "FAIL if: type errors, obvious bugs, regressions, OR stub/placeholder code.",
    "Stubs are NOT acceptable — every function must have real implementation.",
  ].join("\n");

  const args = buildProviderArgs(provider, {
    prompt,
    systemPrompt: "You are a code auditor. Review code changes and output a JSON verdict.",
    nonInteractive: true,
    dangerouslySkipPermissions: true,
    fullAuto: true,
  });

  let finalArgs: string[];
  let stdinInput: string | undefined;

  if (provider === "codex") {
    // codex exec --full-auto - : reads prompt from stdin (avoids shell escaping issues)
    finalArgs = ["exec", "--full-auto", "-"];
    stdinInput = prompt;
  } else {
    finalArgs = args;
    stdinInput = undefined;
  }

  // On Windows, use cmd /c to handle .cmd wrappers without shell:true
  // (shell:true corrupts multi-line args passed via buildProviderArgs).
  const isWin = process.platform === "win32";
  const spawnBin = isWin ? (process.env.ComSpec ?? "cmd.exe") : bin;
  const spawnArgs = isWin ? ["/c", bin, ...finalArgs] : finalArgs;

  const result = spawnSync(spawnBin, spawnArgs, {
    cwd: repoRoot,
    input: stdinInput,
    stdio: [stdinInput ? "pipe" : "ignore", "pipe", "pipe"],
    env: { ...process.env },
    timeout: 300_000,
    encoding: "utf8",
    windowsHide: true,
  });

  // Debug: log non-zero exit code
  if (result.status !== 0) {
    const stderrSnippet = ((result.stderr ?? "") as string).slice(0, 300);
    console.error(`  [audit-debug] ${provider} exit=${result.status} signal=${result.signal} stderr=${stderrSnippet}`);
  }

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

  // Codex may output JSON without fences
  const bareJsonMatch = output.match(/\{[\s\S]*"passed"\s*:\s*(true|false)[\s\S]*\}/);
  if (bareJsonMatch) {
    try {
      const verdict = JSON.parse(bareJsonMatch[0]);
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
