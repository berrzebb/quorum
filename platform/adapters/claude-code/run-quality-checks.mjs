/**
 * Shared quality-check runner — used by task-completed.mjs and teammate-idle.mjs.
 *
 * Loads quality_rules presets from config, finds matching presets by detect file,
 * runs per_file and whole-project checks, returns failure messages.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

/** Escape a string for safe interpolation into a shell command. */
function shellEscape(s) {
  if (process.platform === "win32") {
    // Windows: wrap in double quotes, escape internal double quotes
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  // POSIX: wrap in single quotes, escape internal single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Run quality checks from config presets.
 *
 * @param {object} params
 * @param {object|null} params.config - Parsed quorum config (or null if unavailable)
 * @param {string} params.repoRoot - Absolute path to repo root
 * @param {string[]} params.changedFiles - List of changed file paths (relative)
 * @returns {string[]} Array of failure messages (empty = all passed)
 */
export function runQualityChecks({ config, repoRoot, changedFiles }) {
  const failures = [];
  const presets = config?.quality_rules?.presets ?? [];

  const activePresets = presets
    .filter(p => existsSync(resolve(repoRoot, p.detect)))
    .sort((a, b) => (a.precedence ?? 50) - (b.precedence ?? 50));

  if (activePresets.length === 0) return failures;

  const shellOpt = process.platform === "win32"
    ? process.env.COMSPEC || "cmd.exe"
    : true;

  for (const preset of activePresets) {
    for (const check of preset.checks ?? []) {
      if (check.per_file) {
        for (const file of changedFiles) {
          const fullPath = resolve(repoRoot, file);
          if (!existsSync(fullPath)) continue;
          const cmd = check.command.replace("{file}", shellEscape(file));
          const result = spawnSync(cmd, {
            cwd: repoRoot,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 30000,
            shell: shellOpt,
            windowsHide: true,
          });
          if (result.status !== 0 && result.status !== null) {
            if (check.optional) continue;
            const output = result.stdout || result.stderr || "";
            failures.push(`[${check.id}] ${check.label}: ${file}\n${output.slice(0, 200)}`);
          }
          if (result.error) {
            if (check.optional) continue;
            failures.push(`[${check.id}] ${check.label}: ${file}\n${result.error.message}`);
          }
        }
      } else {
        const result = spawnSync(check.command, {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 60000,
          shell: shellOpt,
          windowsHide: true,
        });
        if (result.status !== 0 && result.status !== null) {
          if (check.optional) continue;
          const output = result.stdout || result.stderr || "";
          failures.push(`[${check.id}] ${check.label}\n${output.slice(-300)}`);
        }
        if (result.error) {
          if (check.optional) continue;
          failures.push(`[${check.id}] ${check.label}\n${result.error.message}`);
        }
      }
    }
  }

  return failures;
}
