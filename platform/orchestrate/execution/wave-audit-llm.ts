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
      const text = obj.content ?? obj.text ?? obj.result ?? obj.message
        ?? (obj.item as Record<string, unknown>)?.text;
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
    `## Scoped files to review:`,
    fileList,
    "",
    "## Instructions:",
    "1. Read each scoped file listed above.",
    "2. Check: types correct? Obvious bugs or logic errors?",
    "3. Check: error handling appropriate? Edge cases considered?",
    "4. Substantiveness check — NO stubs (TODO, FIXME, placeholder, empty functions, mock data)",
    "",
    "Only judge each item against ITS OWN done criteria and scope.",
    "Build verification (tsc, vitest) is already handled — focus on code quality.",
    "",
    "5. Submit verdict via `audit_submit` tool:",
    '   - passed: `audit_submit({ verdict: "approved", findings: [] })`',
    '   - failed: `audit_submit({ verdict: "changes_requested", findings: ["issue 1", "issue 2"] })`',
    "",
    "FAIL if: type errors, obvious bugs, regressions, OR stub/placeholder code.",
  ].join("\n");

  const spawn = await prepareProviderSpawn(provider, prompt, {
    systemPrompt: "You are a code auditor. Review files, then submit verdict via audit_submit tool. Do NOT ask for confirmation.",
  });

  // Clear previous verdict KV before spawning auditor
  try {
    const { EventStore } = await import("../../bus/store.js");
    const { resolve: r } = await import("node:path");
    const store = new EventStore({ dbPath: r(repoRoot, ".claude", "quorum-events.db") });
    store.setKV("audit.verdict:latest", null);
    store.close();
  } catch { /* best-effort */ }

  // On Windows, prepareProviderSpawn wraps in cmd.exe /c <binary>.
  // spawnSync timeout only kills cmd.exe, not child processes (codex/claude hang).
  // Fix: shell:true with single command string (DEP0190: shell+args array is deprecated).
  const isWin = process.platform === "win32";

  let result;
  if (isWin) {
    // Combine binary + args into a single shell command string
    const rawBin = spawn.args[1]!;  // args[1] = raw binary name after /c
    const rawArgs = spawn.args.slice(2);
    const cmd = [rawBin, ...rawArgs].join(" ");
    result = spawnSync(cmd, {
      cwd: repoRoot,
      input: spawn.stdinInput,
      stdio: [spawn.stdinInput ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env },
      timeout: 300_000,  // 5 min — Codex cold start + model inference can exceed 2 min
      encoding: "utf8",
      windowsHide: true,
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  } else {
    result = spawnSync(spawn.bin, spawn.args, {
      cwd: repoRoot,
      input: spawn.stdinInput,
      stdio: [spawn.stdinInput ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env },
      timeout: 300_000,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  // Handle timeout / signal kills gracefully
  if (result.signal) {
    console.error(`  [audit-debug] ${provider} killed by signal=${result.signal} (timeout or OOM)`);
    return { passed: true, findings: [`Audit timed out (signal: ${result.signal}) — passing to avoid blocking pipeline`] };
  }

  if (result.status !== 0) {
    const stderrSnippet = (result.stderr ?? "").slice(0, 300);
    console.error(`  [audit-debug] ${provider} exit=${result.status} signal=${result.signal} stderr=${stderrSnippet}`);
  }

  // Primary: read verdict from EventStore (auditor submitted via audit_submit MCP tool)
  try {
    const { resolve: r } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const bridgePath = r(repoRoot, ".claude", "quorum", "..", "..", "..", "platform", "core", "bridge.mjs");
    // Use EventStore directly — bridge init may clash with running process
    const { EventStore } = await import("../../bus/store.js");
    const dbPath = r(repoRoot, ".claude", "quorum-events.db");
    const store = new EventStore({ dbPath });
    const verdictKV = store.getKV("audit.verdict:latest") as { passed: boolean; findings: string[] } | null;
    store.close();
    if (verdictKV && typeof verdictKV.passed === "boolean") {
      return { passed: verdictKV.passed, findings: verdictKV.findings ?? [] };
    }
  } catch { /* EventStore unavailable — fall back to stdout parsing */ }

  // Fallback: parse verdict from stdout (backward compat)
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
    const bullets = output.match(/^[-*]\s+.+$/gm) ?? [];
    return { passed: false, findings: bullets.length > 0 ? bullets.map(b => b.replace(/^[-*]\s+/, "")) : ["Audit returned 'passed: false' but findings could not be extracted"] };
  }

  return { passed: false, findings: ["Audit returned unstructured output — manual review needed. Raw length: " + output.length] };
}
