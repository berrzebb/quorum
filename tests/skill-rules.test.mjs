/**
 * Tests: Skill Rules Engine (WB-5)
 * matchSkills() — file pattern + keyword 3-way matching.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchSkills, parseSkillRules } from "../platform/adapters/shared/skill-rules.mjs";

const SAMPLE_RULES = [
  { pattern: "*.tsx", keywords: ["component", "react"], skills: ["frontend"], domains: ["a11y", "compat"] },
  { pattern: "*.ts", keywords: ["typescript"], skills: ["backend"], domains: [] },
  { pattern: "src/auth/**", keywords: ["auth", "login", "security"], skills: ["security"], domains: ["security"] },
  { pattern: "*.css", keywords: ["style", "css"], skills: ["frontend"], domains: ["a11y"] },
  { pattern: "migrations/**", keywords: ["migration", "schema"], skills: ["database"], domains: ["migration"] },
  { pattern: "*.test.ts", keywords: ["test"], skills: ["testing"], domains: [] },
];

describe("matchSkills", () => {
  // ── File pattern matching ─────────────────────
  describe("file pattern", () => {
    it("matches *.tsx extension", () => {
      const r = matchSkills(SAMPLE_RULES, "src/Button.tsx");
      assert.ok(r.skills.includes("frontend"));
      assert.ok(r.domains.includes("a11y"));
    });

    it("matches deep path with **", () => {
      const r = matchSkills(SAMPLE_RULES, "src/auth/middleware/jwt.ts");
      assert.ok(r.skills.includes("security"));
      assert.ok(r.domains.includes("security"));
    });

    it("matches migrations glob", () => {
      const r = matchSkills(SAMPLE_RULES, "migrations/001_users.sql");
      assert.ok(r.skills.includes("database"));
      assert.ok(r.domains.includes("migration"));
    });

    it("no match for unknown extension", () => {
      const r = matchSkills(SAMPLE_RULES, "README.md");
      assert.equal(r.skills.length, 0);
      assert.equal(r.domains.length, 0);
    });
  });

  // ── Keyword matching ──────────────────────────
  describe("keyword matching", () => {
    it("matches keyword in prompt", () => {
      const r = matchSkills(SAMPLE_RULES, undefined, "add a react component");
      assert.ok(r.skills.includes("frontend"));
    });

    it("keyword is case-insensitive", () => {
      const r = matchSkills(SAMPLE_RULES, undefined, "SECURITY audit needed");
      assert.ok(r.skills.includes("security"));
    });

    it("no keyword match for unrelated prompt", () => {
      const r = matchSkills(SAMPLE_RULES, undefined, "fix the build");
      assert.equal(r.skills.length, 0);
    });
  });

  // ── Combined matching ─────────────────────────
  describe("combined", () => {
    it("file match activates without keyword", () => {
      const r = matchSkills(SAMPLE_RULES, "src/auth/login.ts");
      assert.ok(r.skills.includes("security"));
    });

    it("keyword match activates without file", () => {
      const r = matchSkills(SAMPLE_RULES, undefined, "migration script");
      assert.ok(r.skills.includes("database"));
    });

    it("deduplicates skills and domains", () => {
      // Both *.tsx and keyword "component" match → frontend should appear once
      const r = matchSkills(SAMPLE_RULES, "App.tsx", "react component");
      const frontendCount = r.skills.filter(s => s === "frontend").length;
      assert.equal(frontendCount, 1);
    });

    it("multiple rules can match", () => {
      // *.test.ts matches *.ts AND *.test.ts
      const r = matchSkills(SAMPLE_RULES, "src/auth/login.test.ts");
      assert.ok(r.skills.includes("backend"));   // *.ts
      assert.ok(r.skills.includes("testing"));    // *.test.ts
      assert.ok(r.skills.includes("security"));   // src/auth/**
    });
  });

  // ── Edge cases ────────────────────────────────
  describe("edge cases", () => {
    it("null rules returns empty", () => {
      const r = matchSkills(null);
      assert.deepEqual(r, { skills: [], domains: [] });
    });

    it("empty rules returns empty", () => {
      const r = matchSkills([]);
      assert.deepEqual(r, { skills: [], domains: [] });
    });

    it("no filePath and no prompt returns empty", () => {
      const r = matchSkills(SAMPLE_RULES);
      assert.deepEqual(r, { skills: [], domains: [] });
    });

    it("backslash paths normalized", () => {
      const r = matchSkills(SAMPLE_RULES, "src\\auth\\token.ts");
      assert.ok(r.skills.includes("security"));
    });
  });
});

describe("parseSkillRules", () => {
  it("parses valid rules", () => {
    const rules = parseSkillRules({ rules: [{ pattern: "*.ts", skills: ["ts"], domains: [] }] });
    assert.equal(rules.length, 1);
    assert.equal(rules[0].pattern, "*.ts");
  });

  it("filters rules without pattern", () => {
    const rules = parseSkillRules({ rules: [
      { pattern: "*.ts", skills: ["ts"], domains: [] },
      { keywords: ["test"], skills: ["test"], domains: [] },  // no pattern
    ] });
    assert.equal(rules.length, 1);
  });

  it("returns empty for null", () => {
    assert.deepEqual(parseSkillRules(null), []);
  });

  it("returns empty for missing rules array", () => {
    assert.deepEqual(parseSkillRules({ other: "data" }), []);
  });
});
