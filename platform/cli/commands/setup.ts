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
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Resolve to the quorum package root (works for global, local, and npm link). */
const QUORUM_PKG_ROOT = resolve(__dirname, "..", "..", "..", "..");

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const quorumDir = resolve(repoRoot, ".claude", "quorum");
  const steps: { label: string; ok: boolean }[] = [];

  // Locale selection: --locale <code> or interactive prompt
  let locale = "en";
  const localeIdx = args.indexOf("--locale");
  if (localeIdx >= 0 && args[localeIdx + 1]) {
    locale = args[localeIdx + 1]!;
  } else if (!args.includes("--yes") && !args.includes("-y")) {
    // Interactive: ask user to pick language
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(r =>
      rl.question("  Language / 언어 (en/ko) [en]: ", r),
    );
    rl.close();
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

  // 2. Config file
  const configPath = resolve(quorumDir, "config.json");
  if (!existsSync(configPath)) {
    const defaultConfig = {
      plugin: {
        locale,
        audit_script: "audit.mjs",
        respond_script: "respond.mjs",
        hooks_enabled: {
          audit: true,
          session_gate: true,
          quality_rules: true,
        },
      },
      consensus: {
        trigger_tag: "[REVIEW_NEEDED]",
        agree_tag: "[APPROVED]",
        pending_tag: "[CHANGES_REQUESTED]",
        planning_dirs: ["docs/design"],
      },
      quality_rules: { presets: detectPresets(repoRoot), overrides: [] },
    };
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n");
    steps.push({ label: `Generated config.json (detected: ${defaultConfig.quality_rules.presets.map(p => p.label).join(", ") || "none"})`, ok: true });
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
    } catch { /* fresh start */ }
  }

  const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
  if (!mcpServers.quorum) {
    // platform/core/tools/ is the canonical location (no root core/ fallback)
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
  console.log("  Steps:");
  for (const step of steps) {
    console.log(`  ${step.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${step.label}`);
  }

  console.log(`\n\x1b[32mSetup complete.\x1b[0m`);
  console.log(`\nNext steps:`);
  console.log(`  quorum daemon     Start the TUI dashboard`);
  console.log(`  quorum status     Check gate status`);
  console.log(`  quorum help       See all commands\n`);
}
