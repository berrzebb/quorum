/**
 * quorum doctor — diagnose and fix issues that could trap agents.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rmSync, existsSync } from "node:fs";

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
}
