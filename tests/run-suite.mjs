#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolveTargets, listSuites, toRepoRelative } from "./suites.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  node tests/run-suite.mjs [suite...]");
  console.log("  node tests/run-suite.mjs --list");
  console.log("");
  console.log("Examples:");
  console.log("  npm test");
  console.log("  npm run test:smoke");
  console.log("  npm run test:contracts");
  console.log("  node tests/run-suite.mjs hooks orchestrate");
}

function printSuites() {
  console.log("Available suites:");
  for (const suite of listSuites()) {
    console.log(`  ${suite.name.padEnd(12)} ${String(suite.count).padStart(3)} files  ${suite.description}`);
  }
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (args.includes("--list")) {
  printSuites();
  process.exit(0);
}

const requested = args.length > 0 ? args : ["all"];
let files;

try {
  files = resolveTargets(requested);
} catch (error) {
  console.error(error.message);
  console.error("");
  printSuites();
  process.exit(1);
}

if (files.length === 0) {
  console.error("No test files matched the requested suite.");
  process.exit(1);
}

console.log(`Running ${files.length} test files:`);
for (const file of files) {
  console.log(`  - ${toRepoRelative(file)}`);
}
console.log("");

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: true,
});

process.exit(result.status ?? 1);
