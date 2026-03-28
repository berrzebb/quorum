#!/usr/bin/env node
/**
 * Syntax-check all quorum .mjs files.
 * Usage: node <this-script>
 *
 * Hooks dir is resolved relative to script location or git root.
 */
import { readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findHooksDir() {
  // script is at skills/verify-implementation/scripts/ → hooks root is ../../..
  const fromScript = resolve(__dirname, "..", "..", "..");
  if (existsSync(resolve(fromScript, "index.mjs"))) return fromScript;

  // Fallback: git root
  try {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8", windowsHide: true }).trim();
    const fromRoot = resolve(root, ".claude", "hooks", "quorum");
    if (existsSync(resolve(fromRoot, "index.mjs"))) return fromRoot;
  } catch { /* git unavailable */ }

  console.error("Could not find quorum hooks directory");
  process.exit(1);
}

const hooksDir = findHooksDir();
const files = readdirSync(hooksDir).filter((f) => f.endsWith(".mjs"));

let failed = 0;
for (const f of files) {
  const path = resolve(hooksDir, f);
  try {
    execSync(`node --check "${path}"`, { stdio: "pipe", shell: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : true, windowsHide: true });
    console.log(`  ✓ ${f}`);
  } catch {
    console.error(`  ✗ ${f}`);
    failed++;
  }
}

console.log(`\n${files.length - failed}/${files.length} passed`);
process.exit(failed > 0 ? 1 : 0);
