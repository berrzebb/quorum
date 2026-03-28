import { existsSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TESTS_DIR = resolve(REPO_ROOT, "tests");

function testFile(name) {
  return resolve(TESTS_DIR, name);
}

function uniqueExisting(files) {
  return [...new Set(files)].filter(file => existsSync(file)).sort();
}

function discoverAllTests() {
  return readdirSync(TESTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map(entry => resolve(TESTS_DIR, entry.name))
    .sort();
}

const SUITE_DEFINITIONS = {
  smoke: [
    "platform-path-compat.test.mjs",
    "adapter-wrapper-compat.test.mjs",
    "skill-neutrality.test.mjs",
    "provider.test.mjs",
    "cli.test.mjs",
    "plan-command.test.mjs",
    "contract-enforcer.test.mjs",
    "runtime-evaluation-spec.test.mjs",
  ],
  contracts: [
    "platform-path-compat.test.mjs",
    "platform-only-layout.test.mjs",
    "adapter-wrapper-compat.test.mjs",
    "skill-neutrality.test.mjs",
    "language-registry.test.mjs",
    "agent-persona.test.mjs",
    "contract-enforcer.test.mjs",
    "contract-negotiation.test.mjs",
    "contract-negotiation-gate.test.mjs",
    "handoff-gate.test.mjs",
    "runtime-evaluation-spec.test.mjs",
    "runtime-evaluation-gate.test.mjs",
    "adaptive-gate-profile.test.mjs",
  ],
  runtime: [
    "bridge.test.mjs",
    "bus.test.mjs",
    "claim.test.mjs",
    "confluence.test.mjs",
    "amendment.test.mjs",
    "context-hooks.test.mjs",
    "lock.test.mjs",
    "message-bus.test.mjs",
    "mux.test.mjs",
    "mux-integration.test.mjs",
    "normal-form.test.mjs",
    "projector.test.mjs",
    "router.test.mjs",
    "store.test.mjs",
    "worktree-isolation.test.mjs",
  ],
  providers: [
    "auditors.test.mjs",
    "codex-provider.test.mjs",
    "domain-router.test.mjs",
    "mux-auditor.test.mjs",
    "provider.test.mjs",
    "specialist-tools.test.mjs",
  ],
  tools: [
    "ast-analyzer.test.mjs",
    "ast-program.test.mjs",
    "blast-radius.test.mjs",
    "fvm-validator.test.mjs",
    "hybrid-scan.test.mjs",
    "language-registry.test.mjs",
    "mcp-tools.test.mjs",
  ],
  hooks: [
    "hook-runner.test.mjs",
    "hooks-lifecycle.test.mjs",
    "all-hooks-live.test.mjs",
  ],
  parliament: [
    "consensus.test.mjs",
    "meeting-log.test.mjs",
    "parliament-cli.test.mjs",
    "parliament-e2e.test.mjs",
    "parliament-gate.test.mjs",
    "parliament-mux-e2e.test.mjs",
  ],
  orchestrate: [
    "act-analyze.test.mjs",
    "adaptive-gate-profile.test.mjs",
    "audit-history.test.mjs",
    "auto-learn.test.mjs",
    "blueprint-lint.test.mjs",
    "contract-enforcer.test.mjs",
    "contract-negotiation.test.mjs",
    "contract-negotiation-gate.test.mjs",
    "fitness-loop.test.mjs",
    "fitness.test.mjs",
    "handoff-gate.test.mjs",
    "orchestrate-compat.test.mjs",
    "orchestrate-integration.test.mjs",
    "plan-command.test.mjs",
    "roadmap-features.test.mjs",
    "runtime-evaluation-gate.test.mjs",
    "runtime-evaluation-spec.test.mjs",
    "stagnation.test.mjs",
    "trigger-fitness.test.mjs",
    "wave-gates.test.mjs",
  ],
  integration: [
    "agent-comm.test.mjs",
    "agent-loader.test.mjs",
    "e2e-smoke.test.mjs",
    "enforcement-smoke.test.mjs",
    "integration.test.mjs",
    "multi-model-integration.test.mjs",
    "mux-integration.test.mjs",
  ],
};

export function listSuites() {
  return [
    { name: "all", count: discoverAllTests().length, description: "Run every top-level test file." },
    { name: "smoke", count: SUITE_DEFINITIONS.smoke.length, description: "Fast regression checks for core contracts." },
    { name: "contracts", count: SUITE_DEFINITIONS.contracts.length, description: "Layout, compatibility, and harness contract tests." },
    { name: "runtime", count: SUITE_DEFINITIONS.runtime.length, description: "Bus, store, mux, and runtime substrate tests." },
    { name: "providers", count: SUITE_DEFINITIONS.providers.length, description: "Provider and auditor tests." },
    { name: "tools", count: SUITE_DEFINITIONS.tools.length, description: "Tooling and analysis engine tests." },
    { name: "hooks", count: SUITE_DEFINITIONS.hooks.length, description: "Hook runner, lifecycle, and live hook tests." },
    { name: "parliament", count: SUITE_DEFINITIONS.parliament.length, description: "Parliament and consensus tests." },
    { name: "orchestrate", count: SUITE_DEFINITIONS.orchestrate.length, description: "Planner, gates, runtime evaluation, and wave tests." },
    { name: "integration", count: SUITE_DEFINITIONS.integration.length, description: "Cross-cutting integration and smoke tests." },
  ];
}

export function resolveSuite(name) {
  if (name === "all") return discoverAllTests();
  const suite = SUITE_DEFINITIONS[name];
  if (!suite) return null;
  return uniqueExisting(suite.map(testFile));
}

export function resolveTargets(args) {
  const files = [];

  for (const arg of args) {
    if (!arg || arg === "all") {
      files.push(...discoverAllTests());
      continue;
    }

    const suite = resolveSuite(arg);
    if (suite) {
      files.push(...suite);
      continue;
    }

    const direct = resolve(REPO_ROOT, arg);
    if (existsSync(direct)) {
      files.push(direct);
      continue;
    }

    throw new Error(`Unknown suite or file: ${arg}`);
  }

  return uniqueExisting(files);
}

export function toRepoRelative(file) {
  return relative(REPO_ROOT, file).replace(/\\/g, "/");
}
