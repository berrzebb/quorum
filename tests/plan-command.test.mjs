/**
 * Plan command tests — verifies plan.ts uses orchestrate/planning module
 * and produces correct output with no duplicated parser logic.
 *
 * Run: node --test tests/plan-command.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const TMP = resolve(tmpdir(), `quorum-plan-cmd-${Date.now()}`);

before(() => mkdirSync(TMP, { recursive: true }));
after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });

function writePlan(trackName, wbContent, rtmContent) {
  const dir = resolve(TMP, "docs", trackName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "work-breakdown.md"), wbContent, "utf8");
  if (rtmContent) {
    writeFileSync(resolve(dir, "rtm.md"), rtmContent, "utf8");
  }
}

// ═══ 1. Module import — plan.ts loads without errors ═════════════════

describe("plan.ts module", () => {
  it("can be imported", async () => {
    const plan = await import("../dist/cli/commands/plan.js");
    assert.ok(plan.run, "run function exists");
    assert.equal(typeof plan.run, "function");
  });
});

// ═══ 2. quorum plan list — flat WB ══════════════════════════════════

describe("quorum plan list", () => {
  it("lists tracks from flat WB", () => {
    writePlan("alpha", `# Work Breakdown

## TST-1: First task

**Target Files**: \`src/a.ts\`
**Action**: Do something
**Verify**: npm test

## TST-2: Second task

**Target Files**: \`src/b.ts\`
**Action**: Do something else
**Verify**: npm test
`);

    const cliPath = resolve("dist/cli/index.js");
    const out = execFileSync("node", [cliPath, "plan", "list"], {
      cwd: TMP, encoding: "utf8", timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.ok(out.includes("alpha"), "shows track name");
    assert.ok(out.includes("TST-1"), "shows first item");
    assert.ok(out.includes("TST-2"), "shows second item");
  });
});

// ═══ 3. quorum plan list — hierarchical WB ══════════════════════════

describe("quorum plan list hierarchical", () => {
  it("lists Phase parents with children", () => {
    writePlan("beta", `# Work Breakdown

## Phase 1: Setup

### BET-1: Init project (XS)

**Target Files**: \`src/init.ts\`
**Action**: Initialize
**Verify**: npm test

### BET-2: Config files (S)

**Target Files**: \`src/config.ts\`
**Action**: Create config
**Verify**: npm test

## Phase 2: Implementation

### BET-3: Core logic (M)

**Target Files**: \`src/core.ts\`
**Action**: Build core
**Verify**: npm test
`);

    const cliPath = resolve("dist/cli/index.js");
    const out = execFileSync("node", [cliPath, "plan", "list"], {
      cwd: TMP, encoding: "utf8", timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.ok(out.includes("beta"), "shows track name");
    assert.ok(out.includes("Phase-1"), "shows Phase 1 parent");
    assert.ok(out.includes("Phase-2"), "shows Phase 2 parent");
    assert.ok(out.includes("BET-1"), "shows child BET-1");
    assert.ok(out.includes("BET-3"), "shows child BET-3");
  });
});

// ═══ 4. quorum plan show — displays raw content ════════════════════

describe("quorum plan show", () => {
  it("shows raw WB content for named track", () => {
    const cliPath = resolve("dist/cli/index.js");
    const out = execFileSync("node", [cliPath, "plan", "show", "alpha"], {
      cwd: TMP, encoding: "utf8", timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.ok(out.includes("First task"), "shows raw markdown content");
    assert.ok(out.includes("Target Files"), "includes field markers");
  });

  it("reports not found for unknown track", () => {
    const cliPath = resolve("dist/cli/index.js");
    const out = execFileSync("node", [cliPath, "plan", "show", "nonexistent"], {
      cwd: TMP, encoding: "utf8", timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.ok(out.includes("not found"), "shows not found message");
  });
});

// ═══ 5. No parser duplication — source check ════════════════════════

describe("no parser duplication", () => {
  it("plan.ts imports from orchestrate/planning, not inline parser", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    // Check platform source (canonical) or facade fallback
    const platformPath = resolve("platform/cli/commands/plan.ts");
    const legacyPath = resolve("cli/commands/plan.ts");
    const src = existsSync(platformPath) ? readFileSync(platformPath, "utf8") : readFileSync(legacyPath, "utf8");

    // Must import from orchestrate/planning
    assert.ok(
      src.includes("orchestrate/planning"),
      "imports from orchestrate/planning module"
    );

    // Must NOT contain the old mirrored parser
    assert.ok(
      !src.includes("scanForBreakdowns"),
      "no scanForBreakdowns function"
    );
    assert.ok(
      !src.includes("Mirrors orchestrate"),
      "no mirror comment"
    );

    // Must NOT have regex-based ID parsing (the hallmark of the old parser)
    assert.ok(
      !src.includes("ID_RE"),
      "no ID_RE regex variable"
    );
    assert.ok(
      !src.includes("hasPhaseParents"),
      "no hasPhaseParents detection"
    );
  });
});
