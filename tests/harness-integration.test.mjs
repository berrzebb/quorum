/**
 * Tests for Phase 3: Harness integration (team-mapper, skill-mapper, workspace-bridge).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `quorum-harness-test-${Date.now()}`);

before(() => { mkdirSync(TEST_DIR, { recursive: true }); });
after(() => { rmSync(TEST_DIR, { recursive: true, force: true }); });

// ── team-mapper ─────────────────────────────────────────

describe("team-mapper", () => {
  let mod;
  before(async () => {
    mod = await import("../dist/platform/providers/harness/team-mapper.js");
  });

  describe("mapTeam", () => {
    it("maps a balanced team correctly", () => {
      const result = mod.mapTeam([
        { name: "builder" },
        { name: "reviewer" },
        { name: "analyst" },
      ]);
      assert.equal(result.agents.length, 3);
      assert.equal(result.consensusReady, true);
      assert.equal(result.missingRoles.length, 0);
    });

    it("auto-supplements missing implementer", () => {
      const result = mod.mapTeam([
        { name: "reviewer" },
        { name: "analyst" },
      ]);
      assert.ok(result.agents.some(a => a.quorumRole === "implementer" && a.supplemented));
      assert.ok(result.warnings.some(w => w.includes("implementer")));
    });

    it("auto-supplements missing self-checker", () => {
      const result = mod.mapTeam([
        { name: "builder" },
      ]);
      assert.ok(result.agents.some(a => a.quorumRole === "self-checker" && a.supplemented));
    });

    it("handles empty team", () => {
      const result = mod.mapTeam([]);
      assert.ok(result.agents.length >= 2); // supplemented
      assert.equal(result.consensusReady, true);
    });

    it("warns on low confidence mappings", () => {
      const result = mod.mapTeam([
        { name: "builder" },
        { name: "reviewer" },
        { name: "mystical-oracle" },
      ]);
      assert.ok(result.warnings.some(w => w.includes("mystical-oracle")));
    });
  });

});

// ── skill-mapper ────────────────────────────────────────

describe("skill-mapper", () => {
  let mod;
  before(async () => {
    mod = await import("../dist/platform/providers/harness/skill-mapper.js");
  });

  describe("validateSkill", () => {
    it("validates a correct skill file", () => {
      const skillDir = join(TEST_DIR, "valid-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: quorum:test-skill
description: "A valid test skill for testing purposes and validation"
---

# Test Skill

This is a valid skill body.`);

      const result = mod.validateSkill(join(skillDir, "SKILL.md"));
      assert.equal(result.valid, true);
      assert.equal(result.issues.length, 0);
      assert.equal(result.name, "quorum:test-skill");
    });

    it("detects missing name", () => {
      const skillDir = join(TEST_DIR, "no-name-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
description: "Has description but no name"
---

# Missing Name`);

      const result = mod.validateSkill(join(skillDir, "SKILL.md"));
      assert.equal(result.valid, false);
      assert.ok(result.issues.some(i => i.includes("name")));
    });

    it("detects missing description", () => {
      const skillDir = join(TEST_DIR, "no-desc-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: quorum:test
---

# No Description`);

      const result = mod.validateSkill(join(skillDir, "SKILL.md"));
      assert.equal(result.valid, false);
      assert.ok(result.issues.some(i => i.includes("description")));
    });

    it("detects adapter-specific tool names", () => {
      const skillDir = join(TEST_DIR, "adapter-tool-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: quorum:bad-skill
description: "Uses adapter-specific tools"
---

# Bad Skill

Use the Read tool to read files.
Then use Bash to run commands.`);

      const result = mod.validateSkill(join(skillDir, "SKILL.md"));
      assert.equal(result.valid, false);
      assert.ok(result.issues.some(i => i.includes("Read")));
      assert.ok(result.issues.some(i => i.includes("Bash")));
    });

    it("returns not found for missing file", () => {
      const result = mod.validateSkill("/nonexistent/path/SKILL.md");
      assert.equal(result.valid, false);
      assert.ok(result.issues[0].includes("not found"));
    });
  });

  describe("normalizeToCanonical", () => {
    it("normalizes a Harness skill to quorum format", () => {
      const srcDir = join(TEST_DIR, "harness-skill");
      const tgtDir = join(TEST_DIR, "canonical-skill");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "skill.md"), `---
name: my-tool
description: "A harness-generated skill"
---

# My Tool

Does things.`);

      const result = mod.normalizeToCanonical(join(srcDir, "skill.md"), tgtDir);
      assert.ok(result);
      assert.ok(existsSync(result));

      // Check the output has quorum: prefix
      const content = readFileSync(result, "utf8");
      assert.ok(content.includes("quorum:my-tool"));
    });

    it("returns null for missing source", () => {
      const result = mod.normalizeToCanonical("/nonexistent/skill.md", TEST_DIR);
      assert.equal(result, null);
    });
  });
});

// ── workspace-bridge ────────────────────────────────────

describe("workspace-bridge", () => {
  let mod;
  before(async () => {
    mod = await import("../dist/platform/providers/harness/workspace-bridge.js");
  });

  it("scanWorkspace returns exists=false when no _workspace/", () => {
    const result = mod.scanWorkspace(join(TEST_DIR, "no-workspace"));
    assert.equal(result.exists, false);
    assert.equal(result.artifacts.length, 0);
  });

  it("scanWorkspace discovers and parses artifacts", () => {
    const wsDir = join(TEST_DIR, "ws-project", "_workspace");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, "01_analyst_requirements.md"), "# Requirements");
    writeFileSync(join(wsDir, "02_builder_implementation.ts"), "export const x = 1;");
    writeFileSync(join(wsDir, "03_reviewer_report.md"), "# Review Report");
    writeFileSync(join(wsDir, "notes.txt"), "unstructured notes");

    const result = mod.scanWorkspace(join(TEST_DIR, "ws-project"));
    assert.equal(result.exists, true);
    assert.equal(result.artifacts.length, 4);
    assert.deepEqual(result.phases, [1, 2, 3]);
    assert.ok(result.agents.includes("analyst"));
    assert.ok(result.agents.includes("builder"));
    assert.ok(result.agents.includes("reviewer"));
  });

  it("parses artifact naming convention correctly", () => {
    const wsDir = join(TEST_DIR, "ws-naming", "_workspace");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, "01_analyst_requirements.md"), "content");

    const result = mod.scanWorkspace(join(TEST_DIR, "ws-naming"));
    const artifact = result.artifacts[0];
    assert.equal(artifact.phase, 1);
    assert.equal(artifact.agent, "analyst");
    assert.equal(artifact.artifact, "requirements");
  });

  it("handles non-convention filenames gracefully", () => {
    const wsDir = join(TEST_DIR, "ws-unconv", "_workspace");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, "random-file.txt"), "content");

    const result = mod.scanWorkspace(join(TEST_DIR, "ws-unconv"));
    const artifact = result.artifacts[0];
    assert.equal(artifact.phase, null);
    assert.equal(artifact.agent, null);
  });

  it("buildHandoffEvent creates bus-compatible event", () => {
    const event = mod.buildHandoffEvent({
      relativePath: "01_analyst_requirements.md",
      absolutePath: "/tmp/01_analyst_requirements.md",
      phase: 1,
      agent: "analyst",
      artifact: "requirements",
      size: 256,
      modifiedAt: "2026-03-31T10:00:00.000Z",
    });
    assert.equal(event.type, "agent.handoff");
    assert.equal(event.source, "analyst");
    assert.equal(event.phase, 1);
    assert.equal(event.artifact, "requirements");
  });
});

