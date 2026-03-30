/**
 * Wave-level LLM audit — spawns a provider CLI to review wave changes.
 *
 * Uses prepareProviderSpawn for provider-aware CLI invocation (claude/codex/gemini).
 * No mechanical gates, no fixer logic — pure LLM review.
 */

import { spawnSync } from "node:child_process";

import { prepareProviderSpawn } from "../core/provider-binary.js";

// ── Verdict Parsing ─────────────────────────

/** Extract {passed, findings} from auditor output. Tries multiple formats. */
function parseAuditVerdict(output: string): { passed: boolean; findings: string[] } | null {
  // Strategy 1: Fenced JSON block (```json ... ```)
  const fencedMatches = output.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g);
  for (const m of fencedMatches) {
    const v = tryParseVerdict(m[1]!);
    if (v) return v;
  }

  // Strategy 2: Any JSON object containing "passed" key (greedy — handles nested arrays)
  // Find opening { before "passed" and match balanced braces
  const passedIdx = output.indexOf('"passed"');
  if (passedIdx >= 0) {
    // Walk backward to find opening brace
    let start = output.lastIndexOf("{", passedIdx);
    if (start >= 0) {
      const candidate = extractBalancedJson(output, start);
      if (candidate) {
        const v = tryParseVerdict(candidate);
        if (v) return v;
      }
    }
  }

  // Strategy 3: NDJSON lines (codex exec --json wraps in event objects)
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    const v = tryParseVerdict(trimmed);
    if (v) return v;
    // Check if it's a wrapper: {type: "message", content: "...{passed...}"}
    try {
      const obj = JSON.parse(trimmed);
      const text = obj.content ?? obj.text ?? obj.result ?? obj.message;
      if (typeof text === "string") {
        const inner = parseAuditVerdict(text);
        if (inner) return inner;
      }
    } catch { /* not JSON */ }
  }

  return null;
}

/** Try to parse a string as a verdict JSON. */
function tryParseVerdict(s: string): { passed: boolean; findings: string[] } | null {
  try {
    const obj = JSON.parse(s.trim());
    if (typeof obj.passed === "boolean") {
      return {
        passed: obj.passed,
        findings: Array.isArray(obj.findings) ? obj.findings : [],
      };
    }
  } catch { /* not valid JSON */ }
  return null;
}

/** Extract a balanced JSON object starting at `start` index. */
function extractBalancedJson(s: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < s.length && i < start + 5000; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// ── Types ───────────────────────────────────

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

  const parsed = parseAuditVerdict(output);
  if (parsed) return parsed;

  // Last resort: heuristic text analysis
  const lowerOutput = output.toLowerCase();
  const hasPassSignal = lowerOutput.includes('"passed": true') || lowerOutput.includes('"passed":true')
    || lowerOutput.includes("all checks pass") || lowerOutput.includes("no issues found")
    || lowerOutput.includes("all items are correctly");
  const hasFailSignal = lowerOutput.includes('"passed": false') || lowerOutput.includes('"passed":false');

  if (hasPassSignal && !hasFailSignal) return { passed: true, findings: [] };
  if (hasFailSignal) {
    // Try to extract bullet points as findings
    const bullets = output.match(/^[-*]\s+.+$/gm) ?? [];
    return { passed: false, findings: bullets.length > 0 ? bullets.map(b => b.replace(/^[-*]\s+/, "")) : ["Audit returned 'passed: false' but findings could not be extracted"] };
  }

  return { passed: false, findings: ["Audit returned unstructured output — manual review needed. Raw length: " + output.length] };
}
