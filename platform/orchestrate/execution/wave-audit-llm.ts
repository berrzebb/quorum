/**
 * Wave-level LLM audit — spawns a provider CLI to review wave changes.
 *
 * Uses prepareProviderSpawn for provider-aware CLI invocation (claude/codex/gemini).
 * No mechanical gates, no fixer logic — pure LLM review.
 */

import { spawnSync } from "node:child_process";

import { prepareProviderSpawn } from "../core/provider-binary.js";

interface WorkItemLike {
  id: string;
  title?: string;
  done?: string;
  verify?: string;
  targetFiles?: string[];
  constraints?: string;
}

/**
 * Run a single LLM audit for all changes in a wave.
 * Uses provider-aware CLI args (claude -p / codex exec / gemini).
 */
export async function runWaveAuditLLM(
  repoRoot: string, files: string[], items: WorkItemLike[], provider: string,
): Promise<{ passed: boolean; findings: string[] }> {

  const fileList = [...new Set(files)].slice(0, 20).map(f => `- ${f}`).join("\n");
  const itemList = items.map(i => {
    const parts = [`- ${i.id}: ${i.title ?? "(no title)"}`];
    if (i.done) parts.push(`  Done: ${i.done}`);
    if (i.verify) parts.push(`  Verify: ${i.verify}`);
    if (i.targetFiles?.length) parts.push(`  Scope: ${i.targetFiles.join(", ")}`);
    if (i.constraints) parts.push(`  Constraints: ${i.constraints}`);
    return parts.join("\n");
  }).join("\n");

  const prompt = [
    "# Wave Audit — Review Implementation Changes",
    "",
    `## Items completed in this wave (with scope and done criteria):`,
    itemList,
    "",
    `## Files to review:`,
    fileList,
    "",
    "## Instructions:",
    "You MAY read files to review code. Do NOT run build/test/lint commands (npm test, tsc, eslint, etc).",
    "Build verification is already handled by the orchestrator. Your role is code quality review.",
    "",
    "IMPORTANT: Only judge each item against ITS OWN done criteria and scope.",
    "Do NOT fail an item for work that belongs to a DIFFERENT work-breakdown item.",
    "Each WB has a defined scope (target files) — out-of-scope concerns are not this item's responsibility.",
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

  const spawn = await prepareProviderSpawn(provider, prompt, {
    systemPrompt: "You are a code auditor. Review code changes and output a JSON verdict.",
  });

  const result = spawnSync(spawn.bin, spawn.args, {
    cwd: repoRoot,
    input: spawn.stdinInput,
    stdio: [spawn.stdinInput ? "pipe" : "ignore", "pipe", "pipe"],
    env: { ...process.env },
    timeout: 300_000,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) {
    const stderrSnippet = (result.stderr ?? "").slice(0, 300);
    console.error(`  [audit-debug] ${provider} exit=${result.status} signal=${result.signal} stderr=${stderrSnippet}`);
  }

  const output = (result.stdout ?? "") as string;

  // Parse verdict from output — fenced JSON (most reliable)
  const jsonMatch = output.match(/```json\s*\n({[\s\S]*?})\s*\n```/);
  if (jsonMatch) {
    try {
      const verdict = JSON.parse(jsonMatch[1]!);
      return {
        passed: !!verdict.passed,
        findings: Array.isArray(verdict.findings) ? verdict.findings : [],
      };
    } catch (err) { console.warn(`[wave-audit-llm] fenced JSON parse failed: ${(err as Error).message}`); }
  }

  // Bare JSON without fences — non-greedy to avoid spanning multiple objects
  const bareJsonMatch = output.match(/\{[^{}]*"passed"\s*:\s*(true|false)[^{}]*\}/);
  if (bareJsonMatch) {
    try {
      const verdict = JSON.parse(bareJsonMatch[0]);
      return {
        passed: !!verdict.passed,
        findings: Array.isArray(verdict.findings) ? verdict.findings : [],
      };
    } catch (err) { console.warn(`[wave-audit-llm] bare JSON parse failed: ${(err as Error).message}`); }
  }

  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes('"passed": true') || lowerOutput.includes("all items are correctly")) {
    return { passed: true, findings: [] };
  }

  return { passed: false, findings: ["Audit returned unstructured output — manual review needed"] };
}
