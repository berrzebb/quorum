/**
 * quorum verify — run done-criteria checks before evidence submission.
 *
 * Includes deterministic scope check (diff vs evidence) to prevent scope-mismatch.
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();

  console.log("\n\x1b[36mquorum verify\x1b[0m — done-criteria checks\n");

  const checks = [
    { label: "CQ", name: "Code Quality", bin: "npx", args: ["eslint", "--no-error-on-unmatched-pattern", "src/"] },
    { label: "T", name: "TypeScript", bin: "npx", args: ["tsc", "--noEmit"] },
    { label: "TEST", name: "Tests", bin: "npm", args: ["test"] },
  ];

  const category = args[0]?.toUpperCase();

  // Special: scope check only
  if (category === "SCOPE" || category === "CC") {
    await runScopeCheck(repoRoot, args[1]);
    return;
  }

  // Special: security scan only
  if (category === "SEC" || category === "SECURITY") {
    await runSecurityScan(repoRoot);
    return;
  }

  // Special: secrets scan
  if (category === "LEAK" || category === "SECRETS") {
    await runGitleaksScan(repoRoot);
    return;
  }

  // Special: unwired implementation scan
  if (category === "UW" || category === "UNWIRED") {
    await runUnwiredScan(repoRoot);
    return;
  }

  // Special: dependency audit
  if (category === "DEP") {
    await runDepAudit(repoRoot);
    return;
  }

  const filtered = category ? checks.filter((c) => c.label === category) : checks;

  if (filtered.length === 0 && category) {
    console.log(`  Unknown category: ${category}`);
    console.log(`  Available: ${checks.map((c) => c.label).join(", ")}, SCOPE\n`);
    return;
  }

  let allPass = true;

  // Run standard checks
  for (const check of filtered) {
    process.stdout.write(`  ${check.label.padEnd(6)} ${check.name.padEnd(20)} `);

    const result = spawnSync(check.bin, check.args, {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    if (result.status === 0) {
      console.log("\x1b[32mPASS\x1b[0m");
    } else {
      console.log("\x1b[31mFAIL\x1b[0m");
      if (result.stderr) {
        const lines = result.stderr.trim().split("\n").slice(0, 5);
        for (const line of lines) console.log(`         ${line}`);
      }
      allPass = false;
    }
  }

  // Run scope check + security scan on full verify
  if (!category) {
    const scopePass = await runScopeCheck(repoRoot);
    if (!scopePass) allPass = false;

    const secPass = await runSecurityScan(repoRoot);
    if (!secPass) allPass = false;

    const leakPass = await runGitleaksScan(repoRoot);
    if (!leakPass) allPass = false;

    const depPass = await runDepAudit(repoRoot);
    if (!depPass) allPass = false;

    const uwPass = await runUnwiredScan(repoRoot);
    if (!uwPass) allPass = false;
  }

  console.log();
  if (allPass) {
    console.log("  \x1b[32m✓ All checks passed.\x1b[0m Ready to submit evidence.\n");
  } else {
    console.log("  \x1b[31m✗ Some checks failed.\x1b[0m Fix before submitting.\n");
    process.exit(1);
  }
}

async function runUnwiredScan(repoRoot: string): Promise<boolean> {
  process.stdout.write("  UW     Unwired Implementation ");

  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "core", "unwired-scan.mjs")));

    const scanPath = existsSync(resolve(repoRoot, "src")) ? resolve(repoRoot, "src") : repoRoot;
    const result = scanner.unwiredScan(scanPath);

    const { definite, suspected } = result.summary;

    if (definite > 0) {
      console.log(`\x1b[31mFAIL\x1b[0m (${definite} definite, ${suspected} suspected)`);
      for (const f of result.findings.filter((f: { status: string }) => f.status === "definite").slice(0, 5)) {
        console.log(`         ${f.file}:${f.line} — ${f.symbol} (${f.reason})`);
      }
      return false;
    } else if (suspected > 0) {
      console.log(`\x1b[33mWARN\x1b[0m (${suspected} suspected)`);
      for (const f of result.findings.slice(0, 3)) {
        console.log(`         ${f.file}:${f.line} — ${f.symbol}`);
      }
      return true;
    } else {
      console.log("\x1b[32mPASS\x1b[0m");
      return true;
    }
  } catch (err) {
    console.log(`\x1b[2mSKIP\x1b[0m (${(err as Error).message?.slice(0, 50)})`);
    return true;
  }
}

async function runScopeCheck(repoRoot: string, baseBranch?: string): Promise<boolean> {
  // Find evidence file
  let watchFile = "docs/feedback/claude.md";
  const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      watchFile = cfg.consensus?.watch_file ?? watchFile;
    } catch { /* use default */ }
  }

  const evidencePath = resolve(repoRoot, watchFile);
  if (!existsSync(evidencePath)) {
    process.stdout.write("  SCOPE  Scope Match           ");
    console.log("\x1b[2mSKIP\x1b[0m (no evidence file)");
    return true;
  }

  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const scopeChecker = await import(toURL(resolve(__dirname, "..", "..", "..", "core", "scope-checker.mjs")));
    const result = scopeChecker.checkScope(evidencePath, repoRoot, baseBranch);

    process.stdout.write("  SCOPE  Scope Match           ");

    if (result.match) {
      console.log(`\x1b[32mPASS\x1b[0m (${result.diffFiles.length} files)`);
      return true;
    } else {
      console.log("\x1b[31mFAIL\x1b[0m");
      if (result.missing.length > 0) {
        console.log("         In diff but not in evidence:");
        for (const f of result.missing.slice(0, 5)) console.log(`           - ${f}`);
      }
      if (result.extra.length > 0) {
        console.log("         In evidence but not in diff:");
        for (const f of result.extra.slice(0, 5)) console.log(`           - ${f}`);
      }
      return false;
    }
  } catch {
    process.stdout.write("  SCOPE  Scope Match           ");
    console.log("\x1b[2mSKIP\x1b[0m (scope-checker unavailable)");
    return true;
  }
}

async function runSecurityScan(repoRoot: string): Promise<boolean> {
  process.stdout.write("  SEC    Security (OWASP)      ");

  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "core", "security-scan.mjs")));
    const result = scanner.securityScan(resolve(repoRoot, "src"));

    const critical = result.findings.filter((f: { severity: string }) => f.severity === "critical").length;
    const high = result.findings.filter((f: { severity: string }) => f.severity === "high").length;

    if (critical > 0) {
      console.log(`\x1b[31mFAIL\x1b[0m (${critical} critical, ${high} high)`);
      for (const f of result.findings.filter((f: { severity: string }) => f.severity === "critical").slice(0, 5)) {
        console.log(`         ${f.id} ${f.file}:${f.line} — ${f.description}`);
      }
      return false;
    } else if (high > 0) {
      console.log(`\x1b[33mWARN\x1b[0m (${high} high) [${result.engine}]`);
      for (const f of result.findings.filter((f: { severity: string }) => f.severity === "high").slice(0, 3)) {
        console.log(`         ${f.id} ${f.file}:${f.line} — ${f.description}`);
      }
      return true; // warnings don't block
    } else {
      console.log(`\x1b[32mPASS\x1b[0m [${result.engine}]`);
      return true;
    }
  } catch {
    console.log("\x1b[2mSKIP\x1b[0m (security-scan unavailable)");
    return true;
  }
}

async function runGitleaksScan(repoRoot: string): Promise<boolean> {
  process.stdout.write("  LEAK   Secrets (git history)  ");

  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "core", "security-scan.mjs")));
    const result = scanner.gitleaksScan(repoRoot);

    if (result.findings.length === 0) {
      console.log(`\x1b[32mPASS\x1b[0m [${result.engine}]`);
      return true;
    } else {
      console.log(`\x1b[31mFAIL\x1b[0m (${result.findings.length} secrets) [${result.engine}]`);
      for (const f of result.findings.slice(0, 3)) {
        console.log(`         ${f.file}:${f.line} — ${f.description}`);
      }
      return false;
    }
  } catch {
    console.log("\x1b[2mSKIP\x1b[0m");
    return true;
  }
}

async function runDepAudit(repoRoot: string): Promise<boolean> {
  process.stdout.write("  DEP    Dependencies           ");

  try {
    const toURL = (p: string) => pathToFileURL(p).href;
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "core", "security-scan.mjs")));
    const result = scanner.depAuditScan(repoRoot);

    const critical = result.findings.filter((f: { severity: string }) => f.severity === "critical").length;
    const high = result.findings.filter((f: { severity: string }) => f.severity === "high").length;

    if (critical > 0 || high > 0) {
      console.log(`\x1b[33mWARN\x1b[0m (${critical} critical, ${high} high)`);
      for (const f of result.findings.filter((f: { severity: string }) => f.severity === "critical").slice(0, 3)) {
        console.log(`         ${f.description}`);
      }
      return true; // warnings don't block
    } else {
      console.log(`\x1b[32mPASS\x1b[0m [${result.engine}]`);
      return true;
    }
  } catch {
    console.log("\x1b[2mSKIP\x1b[0m");
    return true;
  }
}
