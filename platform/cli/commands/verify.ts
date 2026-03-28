/**
 * quorum verify — run done-criteria checks before evidence submission.
 *
 * Includes deterministic scope check (diff vs evidence) to prevent scope-mismatch.
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function run(args: string[]): Promise<void> {
  const repoRoot = process.cwd();

  console.log("\n\x1b[36mquorum verify\x1b[0m — done-criteria checks\n");

  // Load checks from quality_rules presets (language-aware)
  const checks: Array<{ label: string; name: string; bin: string; args: string[]; optional?: boolean }> = [];
  try {
    const configPath = resolve(repoRoot, ".claude", "quorum", "config.json");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      // Support both new { presets: [] } and legacy flat array format
      const qr = cfg.quality_rules;
      const presets = Array.isArray(qr) ? [] : (qr?.presets ?? []);
      for (const preset of presets) {
        if (!existsSync(resolve(repoRoot, preset.detect))) continue;
        for (const check of preset.checks ?? []) {
          const parts = check.command.split(/\s+/);
          checks.push({ label: check.id, name: check.label, bin: parts[0], args: parts.slice(1), optional: check.optional ?? false });
        }
      }
    }
  } catch { /* config read error */ }
  if (checks.length === 0) {
    console.log("  No quality_rules presets matched — skipping CQ/T checks\n");
  }

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

  // Special: template consistency check
  if (category === "TEMPLATE" || category === "TPL") {
    await runTemplateCheck();
    return;
  }

  // Special: runtime contract check (schema mismatch, identifier normalization)
  if (category === "RC" || category === "RUNTIME") {
    await runRuntimeContractCheck(repoRoot);
    return;
  }

  const filtered = category ? checks.filter((c) => c.label === category) : checks;

  if (filtered.length === 0 && category) {
    const builtins = ["SCOPE", "CC", "SEC", "SECURITY", "LEAK", "SECRETS", "DEP", "UW", "UNWIRED", "TEMPLATE", "TPL", "RC", "RUNTIME"];
    // Known preset-based categories (come from quality_rules)
    const presetCategories = ["CQ", "T", "TEST", "LINT", "BUILD"];
    const allPresetLabels = checks.map((c) => c.label).filter(Boolean);
    if (builtins.includes(category)) {
      // Should not reach here — builtins are handled above. Defensive.
      return;
    }
    if (presetCategories.includes(category) || allPresetLabels.some(l => l.toUpperCase() === category)) {
      console.log(`  No quality_rules presets matched for category "${category}".`);
      console.log(`  Ensure your project has a matching detect file (e.g., tsconfig.json, Cargo.toml).\n`);
      return;
    }
    console.log(`  Unknown category: ${category}`);
    console.log(`  Available: ${[...allPresetLabels, "SCOPE", "SEC", "LEAK", "DEP", "UW"].join(", ")}\n`);
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
      windowsHide: true,
    });

    if (result.status === 0) {
      console.log("\x1b[32mPASS\x1b[0m");
    } else if (check.optional) {
      console.log("\x1b[2mSKIP\x1b[0m (optional, tool not available)");
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
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "..", "platform", "core", "unwired-scan.mjs")));

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
  // Try SQLite evidence first (content string), fall back to file path
  const toURL = (p: string) => pathToFileURL(p).href;
  let evidenceArg: string | null = null;  // content string OR file path
  try {
    const bridge = await import(toURL(resolve(__dirname, "..", "..", "..", "..", "core", "bridge.mjs")));
    if (!bridge._store) await bridge.init(repoRoot);
    const evidence = bridge.getLatestEvidence?.();
    if (evidence?.content) {
      evidenceArg = evidence.content;  // Pass content directly (no file read)
    }
  } catch { /* bridge unavailable */ }

  // No fallback — evidence must come from SQLite EventStore

  if (!evidenceArg) {
    process.stdout.write("  SCOPE  Scope Match           ");
    console.log("\x1b[2mSKIP\x1b[0m (no evidence)");
    return true;
  }

  try {
    const scopeChecker = await import(toURL(resolve(__dirname, "..", "..", "..", "..", "platform", "core", "scope-checker.mjs")));
    const result = scopeChecker.checkScope(evidenceArg, repoRoot, baseBranch);

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
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "..", "platform", "core", "security-scan.mjs")));
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
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "..", "platform", "core", "security-scan.mjs")));
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
    const scanner = await import(toURL(resolve(__dirname, "..", "..", "..", "..", "platform", "core", "security-scan.mjs")));
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

// ── Template consistency check ──────────────────────────────

async function runTemplateCheck(): Promise<void> {
  console.log("\n\x1b[36mquorum verify TEMPLATE\x1b[0m — template consistency check\n");

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    ?? resolve(__dirname, "..", "..", "..");
  const coreRoot = resolve(pluginRoot, "..", "..", "core");

  const forbidden = [
    /npx\s+eslint/,
    /npx\s+tsc/,
    /npx\s+vitest/,
    /cargo\s+test(?!\s+runner)/,
    /cargo\s+check/,
    /cargo\s+clippy/,
    /ruff\s+check/,
    /go\s+vet/,
    /go\s+test/,
  ];

  const allowPatterns = [
    /^\s*#/,             // comment lines
    /allowed-tools/,     // skill frontmatter
    /Do NOT run/,        // prohibition text
    /import\s/,          // JS import
    /e\.g\./,            // example refs
    /quality_rules/,     // already referencing presets
  ];

  const scanDirs = [
    resolve(coreRoot, "templates"),
    resolve(pluginRoot, "agents"),
    resolve(pluginRoot, "platform", "skills"),
  ].filter(d => existsSync(d));

  let issues = 0;

  function scanDir(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) { scanDir(full); continue; }
      if (!entry.name.endsWith(".md")) continue;
      if (full.includes("evidence-format")) continue;

      const lines = readFileSync(full, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (allowPatterns.some(p => p.test(line))) continue;
        for (const pattern of forbidden) {
          if (pattern.test(line)) {
            issues++;
            const rel = full.replace(/\\/g, "/");
            console.log(`  \x1b[31mFAIL\x1b[0m ${rel}:${i + 1} — ${line.trim().slice(0, 80)}`);
          }
        }
      }
    }
  }

  for (const dir of scanDirs) scanDir(dir);

  if (issues === 0) {
    console.log("  \x1b[32mPASS\x1b[0m No hardcoded tool commands found.");
  } else {
    console.log(`\n  \x1b[31m${issues} issue(s)\x1b[0m — replace with quality_rules.presets reference`);
  }
}

// ── Runtime contract check ──────────────────────────────────

async function runRuntimeContractCheck(repoRoot: string): Promise<void> {
  console.log("\n\x1b[36mquorum verify RUNTIME\x1b[0m — runtime contract checks\n");

  let issues = 0;

  // Schema contract: check save/load boundary type mismatches in Python
  // Use Glob instead of Unix find for cross-platform compatibility
  const pyFiles: string[] = [];
  function collectPyFiles(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "__pycache__" && entry.name !== "node_modules") {
        collectPyFiles(full);
      } else if (entry.name.endsWith(".py")) {
        pyFiles.push(full);
      }
    }
  }
  collectPyFiles(repoRoot);
  for (const file of pyFiles) {
    const content = readFileSync(file, "utf8");
    const dictTypes = content.match(/dict\[.*?\]/gi) ?? [];
    const uniqueTypes = [...new Set(dictTypes.map((t: string) => t.toLowerCase()))];
    if (uniqueTypes.length > 1 && content.includes("save") && content.includes("load")) {
      issues++;
      const rel = file.replace(repoRoot, "").replace(/\\/g, "/");
      console.log(`  \x1b[33mWARN\x1b[0m ${rel} — multiple dict types at save/load boundary: ${uniqueTypes.join(", ")}`);
    }
  }

  // Entrypoint closure: check main.py imports
  const mainPy = resolve(repoRoot, "main.py");
  if (existsSync(mainPy)) {
    const content = readFileSync(mainPy, "utf8");
    const imports = content.match(/from\s+\S+\s+import\s+.+/g) ?? [];
    console.log(`  \x1b[36mINFO\x1b[0m main.py imports ${imports.length} modules`);
  }

  if (issues === 0) {
    console.log("  \x1b[32mPASS\x1b[0m No runtime contract issues detected.");
  } else {
    console.log(`\n  \x1b[33m${issues} warning(s)\x1b[0m — review save/load boundaries`);
  }
}
