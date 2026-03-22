/**
 * quorum doctor — diagnose and fix issues that could trap agents.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const autoFix = args.includes("--fix");

  console.log(`\n\x1b[36mquorum doctor\x1b[0m${autoFix ? " (auto-fix)" : ""}\n`);

  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const { runHealthCheck, formatHealthCheck } = await import(
      toURL(resolve(__dirname, "..", "..", "..", "core", "health-check.mjs"))
    );

    const issues = runHealthCheck(repoRoot);
    console.log(formatHealthCheck(issues));

    if (autoFix && issues.length > 0) {
      console.log("\n\x1b[36mAuto-fixing...\x1b[0m\n");
      let fixed = 0;

      for (const issue of issues) {
        if (issue.severity !== "critical") continue;

        if (issue.category === "placeholder" || issue.category === "worktree-verdict") {
          // Delete the file with unresolved placeholders
          const match = issue.fix?.match(/(?:Delete|rm) "?([^"]+)"?/);
          if (match) {
            const target = resolve(repoRoot, match[1]!);
            if (existsSync(target)) {
              rmSync(target, { force: true });
              console.log(`  \x1b[32m✓\x1b[0m Removed: ${match[1]}`);
              fixed++;
            }
          }
        }

        if (issue.category === "stale-lock") {
          const match = issue.fix?.match(/rm "?([^"]+)"?/);
          if (match) {
            const target = resolve(repoRoot, match[1]!);
            if (existsSync(target)) {
              rmSync(target, { force: true });
              console.log(`  \x1b[32m✓\x1b[0m Removed: ${match[1]}`);
              fixed++;
            }
          }
        }
      }

      console.log(`\n  ${fixed} issue(s) fixed. Run 'quorum doctor' again to verify.\n`);
    } else if (issues.length > 0) {
      console.log(`\n  Run 'quorum doctor --fix' to auto-fix critical issues.\n`);
    }
  } catch (err) {
    console.error(`  Error: ${(err as Error).message}\n`);
  }

  // ── Tool installation check based on quality_rules presets ──
  console.log("\x1b[36mTool availability\x1b[0m\n");
  try {
    const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
    if (!existsSync(configPath)) {
      console.log("  \x1b[2mSKIP\x1b[0m No .claude/quorum/config.json\n");
      return;
    }
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const presets = cfg.quality_rules?.presets ?? [];
    const activePresets = presets.filter((p: { detect: string }) => existsSync(resolve(repoRoot, p.detect)));

    if (activePresets.length === 0) {
      console.log("  \x1b[2mSKIP\x1b[0m No matching presets for this project\n");
      return;
    }

    const installHints: Record<string, string> = {
      eslint: "npm install -D eslint",
      tsc: "npm install -D typescript",
      ruff: "pip install ruff",
      pytest: "pip install pytest",
      "cargo-check": "rustup (includes cargo)",
      clippy: "rustup component add clippy",
      "cargo-test": "rustup (includes cargo)",
      "go-vet": "https://go.dev/dl/",
      "go-test": "https://go.dev/dl/",
      "npm-audit": "npm (built-in)",
    };

    const shellOpt = process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true;
    let missing = 0;

    for (const preset of activePresets) {
      console.log(`  \x1b[1m${preset.label}\x1b[0m (detected: ${preset.detect})`);
      for (const check of preset.checks ?? []) {
        // Extract the actual tool: "npx eslint ..." → "npx eslint", "python -m pytest" → "python -m pytest"
        const parts = check.command.split(/\s+/);
        let versionCmd: string;
        if (parts[0] === "npx") {
          versionCmd = `npx ${parts[1]} --version`;
        } else if (parts[0] === "python" || parts[0] === "python3") {
          versionCmd = `${parts.slice(0, parts.indexOf("-m") >= 0 ? parts.indexOf("-m") + 2 : 1).join(" ")} --version`;
        } else {
          versionCmd = `${parts[0]} --version`;
        }
        const r = spawnSync(versionCmd, {
          shell: shellOpt,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          timeout: 5000,
          windowsHide: true,
        });
        if (r.status === 0) {
          const ver = (r.stdout ?? "").trim().split("\n")[0]?.slice(0, 40) ?? "";
          console.log(`    \x1b[32m✓\x1b[0m ${check.label} (${ver})`);
        } else {
          missing++;
          const hint = installHints[check.label] ?? `install ${parts[0]}`;
          if (check.optional) {
            console.log(`    \x1b[33m⚠\x1b[0m ${check.label} — not installed (optional). Install: \x1b[36m${hint}\x1b[0m`);
          } else {
            console.log(`    \x1b[31m✗\x1b[0m ${check.label} — not installed. Install: \x1b[36m${hint}\x1b[0m`);
          }
        }
      }
    }

    if (missing === 0) {
      console.log("\n  \x1b[32mAll tools available.\x1b[0m\n");
    } else {
      console.log(`\n  \x1b[33m${missing} tool(s) missing.\x1b[0m\n`);
    }
  } catch (err) {
    console.error(`  Tool check error: ${(err as Error).message}\n`);
  }
}
