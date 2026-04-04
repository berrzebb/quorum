/**
 * quorum setup — one-shot project initialization.
 *
 * 1. Generate config.json if missing
 * 2. Register MCP server in .mcp.json
 * 3. Set up feedback directory structure
 * 4. Optionally install Claude Code adapter hooks
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";

interface QualityPreset {
  detect: string;
  root: string;
  label: string;
  precedence: number;
  checks: Array<{ id: string; label: string; command: string; per_file: boolean; optional?: boolean }>;
  artifacts: string[];
  result_normalization: string;
}

const ALL_PRESETS: QualityPreset[] = [
  {
    detect: "tsconfig.json", root: ".", label: "typescript", precedence: 10,
    checks: [
      { id: "CQ-1", label: "eslint", command: "npx eslint --no-error-on-unmatched-pattern \"{file}\"", per_file: true },
      { id: "CQ-2", label: "tsc", command: "npx tsc --noEmit", per_file: false },
      { id: "T-1", label: "test", command: "npm test -- --run", per_file: false },
    ],
    artifacts: ["node_modules"], result_normalization: "exit_code",
  },
  {
    detect: "pyproject.toml", root: ".", label: "python", precedence: 10,
    checks: [
      { id: "CQ-1", label: "ruff", command: "ruff check \"{file}\"", per_file: true, optional: true },
      { id: "T-1", label: "pytest", command: "python -m pytest -x -q", per_file: false },
    ],
    artifacts: ["__pycache__", ".pytest_cache"], result_normalization: "exit_code",
  },
  {
    detect: "setup.py", root: ".", label: "python-legacy", precedence: 20,
    checks: [
      { id: "T-1", label: "pytest", command: "python -m pytest -x -q", per_file: false },
    ],
    artifacts: ["__pycache__"], result_normalization: "exit_code",
  },
  {
    detect: "Cargo.toml", root: ".", label: "rust", precedence: 10,
    checks: [
      { id: "CQ-1", label: "cargo-check", command: "cargo check", per_file: false },
      { id: "CQ-2", label: "clippy", command: "cargo clippy -- -D warnings", per_file: false },
      { id: "T-1", label: "cargo-test", command: "cargo test", per_file: false },
    ],
    artifacts: ["target"], result_normalization: "exit_code",
  },
  {
    detect: "go.mod", root: ".", label: "go", precedence: 10,
    checks: [
      { id: "CQ-1", label: "go-vet", command: "go vet ./...", per_file: false },
      { id: "T-1", label: "go-test", command: "go test ./...", per_file: false },
    ],
    artifacts: [], result_normalization: "exit_code",
  },
];

function detectPresets(repoRoot: string): QualityPreset[] {
  return ALL_PRESETS.filter(p => existsSync(resolve(repoRoot, p.detect)));
}
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Resolve to the quorum package root (works for global, local, and npm link). */
const QUORUM_PKG_ROOT = resolve(__dirname, "..", "..", "..", "..");

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const quorumDir = resolve(repoRoot, ".claude", "quorum");
  const steps: { label: string; ok: boolean }[] = [];
  const isNonInteractive = args.includes("--yes") || args.includes("-y");

  // Pre-read all stdin lines (fixes pipe + readline issue on Windows).
  // Interactive TTY: readline prompts as usual. Piped: lines pre-buffered.
  const isPiped = !process.stdin.isTTY;
  let stdinLines: string[] = [];
  let lineIdx = 0;
  if (isPiped) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    stdinLines = Buffer.concat(chunks).toString("utf8").split("\n").filter(l => l.length > 0);
  }
  const { createInterface } = await import("node:readline");
  let rl: ReturnType<typeof createInterface> | null = null;
  const ask = (q: string): Promise<string> => {
    process.stdout.write(q);
    if (isPiped) {
      const line = stdinLines[lineIdx++] ?? "";
      process.stdout.write(line + "\n");
      return Promise.resolve(line);
    }
    if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(r => rl!.question("", r));
  };
  const closeRl = () => { rl?.close(); rl = null; };

  // Locale selection: --locale <code> or interactive prompt
  let locale = "en";
  const localeIdx = args.indexOf("--locale");
  if (localeIdx >= 0 && args[localeIdx + 1]) {
    locale = args[localeIdx + 1]!;
  } else if (!isNonInteractive) {
    const answer = await ask("  Language / 언어 (en/ko) [en]: ");
    const picked = answer.trim().toLowerCase();
    if (picked === "ko" || picked === "kr") locale = "ko";
  }

  console.log("\n\x1b[36mquorum setup\x1b[0m — initializing project\n");

  // 1. Config directory
  if (!existsSync(quorumDir)) {
    mkdirSync(quorumDir, { recursive: true });
    steps.push({ label: "Created .claude/quorum/", ok: true });
  } else {
    steps.push({ label: ".claude/quorum/ exists", ok: true });
  }

  // 2. Config file — v0.6.4 interview flow (scan → questions → harness)
  const configPath = resolve(quorumDir, "config.json");
  if (!existsSync(configPath)) {
    // Step 2a: Scan project
    let profile: Record<string, unknown> | null = null;
    try {
      const scannerPath = pathToFileURL(resolve(QUORUM_PKG_ROOT, "platform", "adapters", "shared", "project-scanner.mjs")).href;
      const { scanProject } = await import(scannerPath);
      profile = scanProject(repoRoot);
    } catch (err) {
      console.warn(`  [scan] Project scan failed: ${(err as Error).message}`);
    }

    if (profile) {
      // Show scan results
      const scanParts = [
        (profile.languages as string[])?.length > 0 ? `언어: ${(profile.languages as string[]).join(", ")}` : null,
        profile.packageManager ? `패키지: ${profile.packageManager}` : null,
        (profile.frameworks as string[])?.length > 0 ? `프레임워크: ${(profile.frameworks as string[]).join(", ")}` : null,
        profile.ci ? `CI: ${profile.ci}` : null,
        profile.testFramework ? `테스트: ${profile.testFramework}` : null,
        (profile.activeDomains as string[])?.length > 0 ? `도메인: ${(profile.activeDomains as string[]).join(", ")}` : null,
      ].filter(Boolean);
      if (scanParts.length > 0) {
        console.log(`  📋 감지 결과: ${scanParts.join(" | ")}\n`);
      } else {
        console.log(`  📋 감지 결과: (빈 프로젝트)\n`);
      }
      steps.push({ label: `Project scanned (${(profile.languages as string[])?.join(", ") || "no languages"})`, ok: true });
    }

    // Step 2b: Interview
    let finalConfig: Record<string, unknown>;
    if (!isNonInteractive && profile) {
      const interviewPath = pathToFileURL(resolve(QUORUM_PKG_ROOT, "platform", "adapters", "shared", "setup-interview.mjs")).href;
      const { buildInterviewQuestions, getActiveQuestions, processAnswers, composeHarness } = await import(interviewPath);

      const questions = buildInterviewQuestions(profile);
      const active = getActiveQuestions(questions);

      const answers: Array<{id: string; value: string}> = [];
      for (const q of active) {
        const choiceHint = q.choices ? ` [${q.choices.join(" / ")}]` : "";
        const raw = await ask(`  ${q.text}${choiceHint}\n  → `);
        answers.push({ id: q.id, value: raw.trim() || (q.choices?.[0] ?? "") });
      }

      const intent = processAnswers(answers, profile);
      finalConfig = {
        plugin: { locale, hooks_enabled: { audit: true, session_gate: true, quality_rules: true } },
        consensus: {
          trigger_tag: "[REVIEW_NEEDED]",
          agree_tag: "[APPROVED]",
          pending_tag: "[CHANGES_REQUESTED]",
          roles: { advocate: "claude", devil: "claude", judge: "codex" },
        },
        ...composeHarness(intent, profile),
        quality_rules: { presets: detectPresets(repoRoot), overrides: [] },
      };

      console.log(`\n  🎯 프로필: ${(intent as Record<string, unknown>).gateProfile}`);
      console.log(`  📝 의제: ${(intent as Record<string, unknown>).agenda}`);
    } else {
      // Non-interactive or no profile: legacy defaults
      finalConfig = {
        plugin: { locale, hooks_enabled: { audit: true, session_gate: true, quality_rules: true } },
        consensus: {
          trigger_tag: "[REVIEW_NEEDED]",
          agree_tag: "[APPROVED]",
          pending_tag: "[CHANGES_REQUESTED]",
          roles: { advocate: "claude", devil: "claude", judge: "codex" },
        },
        gates: { gateProfile: "balanced" },
        parliament: { convergenceThreshold: 0.7, eligibleVoters: 3, maxRounds: 10, maxAutoAmendments: 5 },
        quality_rules: { presets: detectPresets(repoRoot), overrides: [] },
      };
    }

    writeFileSync(configPath, JSON.stringify(finalConfig, null, 2) + "\n");
    steps.push({ label: `Generated config.json`, ok: true });
  } else {
    steps.push({ label: "config.json exists", ok: true });
  }

  // 3. Evidence storage — SQLite EventStore (no feedback directory needed)
  steps.push({ label: "Evidence: SQLite EventStore (audit_submit tool)", ok: true });

  // 4. MCP server registration
  const mcpPath = resolve(repoRoot, ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, "utf8"));
    } catch (err) { console.warn(`[setup] .mcp.json parse failed: ${(err as Error).message}`); }
  }

  const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
  if (!mcpServers.quorum) {
    const mcpServerPath = resolve(QUORUM_PKG_ROOT, "platform", "core", "tools", "mcp-server.mjs");
    mcpServers.quorum = {
      command: "node",
      args: [mcpServerPath],
      type: "stdio",
    };
    mcpConfig.mcpServers = mcpServers;
    writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    steps.push({ label: "Registered MCP server", ok: true });
  } else {
    steps.push({ label: "MCP server already registered", ok: true });
  }

  // Summary
  console.log("\n  Steps:");
  for (const step of steps) {
    console.log(`  ${step.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${step.label}`);
  }

  closeRl();

  console.log(`\n\x1b[32mSetup complete.\x1b[0m`);
  console.log(`\nNext steps:`);
  console.log(`  quorum daemon     Start the TUI dashboard`);
  console.log(`  quorum status     Check gate status`);
  console.log(`  quorum help       See all commands\n`);
}
