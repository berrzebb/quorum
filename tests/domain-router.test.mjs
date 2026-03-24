#!/usr/bin/env node
/**
 * Domain Detection + Router + Specialist Integration Tests
 *
 * Run: node --test tests/domain-router.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const { detectDomains, formatDomainSummary } = await import("../dist/providers/domain-detect.js");
const { selectReviewers, getActiveRejectionCodes, listDomainReviewers } = await import("../dist/providers/domain-router.js");
const { evaluateTrigger } = await import("../dist/providers/trigger.js");
const { enrichEvidence, buildSpecialistSection } = await import("../dist/providers/specialist.js");

// ═══ 1. Domain Detection ══════════════════════════════════════════════

describe("detectDomains", () => {
  it("detects performance domain from SQL file paths", () => {
    const result = detectDomains(["src/db/query.sql", "src/api/handler.ts"]);
    assert.equal(result.domains.performance, true);
    assert.ok(result.reasons.has("performance"));
  });

  it("detects performance domain from diff content", () => {
    const result = detectDomains(
      ["src/service.ts"],
      "const users = await db.findMany({ where: {} })",
    );
    assert.equal(result.domains.performance, true);
  });

  it("detects migration domain from migration files", () => {
    const result = detectDomains(["db/migrations/001_add_users.sql"]);
    assert.equal(result.domains.migration, true);
  });

  it("detects migration domain from schema changes in diff", () => {
    const result = detectDomains(
      ["prisma/schema.prisma"],
      "ALTER TABLE users ADD COLUMN email TEXT",
    );
    assert.equal(result.domains.migration, true);
  });

  it("detects accessibility only when JSX has a11y content", () => {
    // JSX without a11y content → no detection
    const noA11y = detectDomains(["src/Button.tsx"], "return <div>hello</div>");
    assert.equal(noA11y.domains.accessibility, false);

    // JSX with a11y content → detected
    const withA11y = detectDomains(
      ["src/Button.tsx"],
      'return <button aria-label="close">X</button>',
    );
    assert.equal(withA11y.domains.accessibility, true);
  });

  it("detects accessibility from explicit a11y file", () => {
    const result = detectDomains(["src/utils/a11y-helpers.ts"]);
    assert.equal(result.domains.accessibility, true);
  });

  it("detects compliance domain from PII patterns", () => {
    const result = detectDomains(
      ["src/user-service.ts"],
      "function anonymize(personalData: PII) { return mask(personalData); }",
    );
    assert.equal(result.domains.compliance, true);
  });

  it("detects observability from logger patterns", () => {
    const result = detectDomains(
      ["src/handler.ts"],
      'logger.error("Failed to process", { requestId, error })',
    );
    assert.equal(result.domains.observability, true);
  });

  it("detects documentation domain from README", () => {
    const result = detectDomains(["README.md", "docs/api.md"]);
    assert.equal(result.domains.documentation, true);
  });

  it("detects concurrency from Promise.all pattern", () => {
    const result = detectDomains(
      ["src/batch.ts"],
      "const results = await Promise.allSettled(tasks)",
    );
    assert.equal(result.domains.concurrency, true);
  });

  it("detects concurrency from Worker usage", () => {
    const result = detectDomains(
      ["src/worker-pool.ts"],
      "const worker = new Worker('./process.js')",
    );
    assert.equal(result.domains.concurrency, true);
  });

  it("detects i18n domain from locale files", () => {
    const result = detectDomains(["locales/ko.json", "locales/en.json"]);
    assert.equal(result.domains.i18n, true);
  });

  it("detects i18n from translation function in diff", () => {
    const result = detectDomains(
      ["src/page.tsx"],
      'const label = t("greeting.hello")',
    );
    assert.equal(result.domains.i18n, true);
  });

  it("detects infrastructure from Dockerfile", () => {
    const result = detectDomains(["Dockerfile", "docker-compose.yml"]);
    assert.equal(result.domains.infrastructure, true);
  });

  it("detects infrastructure from CI config", () => {
    const result = detectDomains([".github/workflows/ci.yml"]);
    assert.equal(result.domains.infrastructure, true);
  });

  it("detects multiple domains simultaneously", () => {
    const result = detectDomains(
      ["db/migrations/002.sql", "src/auth.tsx", "locales/en.json"],
      'aria-label="login" ALTER TABLE sessions ADD COLUMN token TEXT t("auth.login")',
    );
    assert.equal(result.domains.migration, true);
    assert.equal(result.domains.accessibility, true);
    assert.equal(result.domains.i18n, true);
    assert.ok(result.activeCount >= 3);
  });

  it("returns zero domains for plain code changes", () => {
    const result = detectDomains(
      ["src/utils/math.ts"],
      "export function add(a: number, b: number) { return a + b; }",
    );
    assert.equal(result.activeCount, 0);
  });

  it("counts active domains correctly", () => {
    const result = detectDomains(
      ["README.md", "Dockerfile"],
    );
    assert.equal(result.domains.documentation, true);
    assert.equal(result.domains.infrastructure, true);
    assert.equal(result.activeCount, 2);
  });
});

describe("formatDomainSummary", () => {
  it("returns message for no domains", () => {
    const result = detectDomains(["src/utils.ts"]);
    const summary = formatDomainSummary(result);
    assert.ok(summary.includes("No specialist"));
  });

  it("includes domain names in summary", () => {
    const result = detectDomains(["Dockerfile"]);
    const summary = formatDomainSummary(result);
    assert.ok(summary.includes("infrastructure"));
  });
});

// ═══ 2. Domain Router ═════════════════════════════════════════════════

describe("selectReviewers", () => {
  it("returns empty when no domains are active", () => {
    const domains = {
      performance: false, migration: false, accessibility: false,
      compliance: false, observability: false, documentation: false,
      concurrency: false, i18n: false, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T2");
    assert.equal(selection.reviewers.length, 0);
    assert.equal(selection.tools.length, 0);
    assert.equal(selection.agents.length, 0);
  });

  it("selects performance reviewer with tool and agent at T2", () => {
    const domains = {
      performance: true, migration: false, accessibility: false,
      compliance: false, observability: false, documentation: false,
      concurrency: false, i18n: false, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T2");
    assert.equal(selection.reviewers.length, 1);
    assert.equal(selection.reviewers[0].domain, "performance");
    assert.ok(selection.tools.includes("perf_scan"));
    assert.ok(selection.agents.includes("perf-analyst"));
  });

  it("activates tools but not agents at T1", () => {
    const domains = {
      performance: true, migration: false, accessibility: false,
      compliance: false, observability: false, documentation: false,
      concurrency: false, i18n: false, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T1");
    assert.equal(selection.reviewers.length, 1);
    assert.ok(selection.tools.includes("perf_scan"));
    assert.equal(selection.agents.length, 0); // T1 < T2 min tier
    assert.equal(selection.reviewers[0].agentActive, false);
  });

  it("activates T3-only agents at T3", () => {
    const domains = {
      performance: false, migration: false, accessibility: false,
      compliance: false, observability: true, documentation: false,
      concurrency: true, i18n: false, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T3");

    const concurrencyReviewer = selection.reviewers.find(r => r.domain === "concurrency");
    assert.ok(concurrencyReviewer);
    assert.equal(concurrencyReviewer.agentActive, true);
    assert.ok(selection.agents.includes("concurrency-verifier"));
  });

  it("does not activate T3 agents at T2", () => {
    const domains = {
      performance: false, migration: false, accessibility: false,
      compliance: false, observability: true, documentation: false,
      concurrency: true, i18n: false, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T2");

    const concurrencyReviewer = selection.reviewers.find(r => r.domain === "concurrency");
    assert.ok(concurrencyReviewer);
    assert.equal(concurrencyReviewer.agentActive, false);
  });

  it("selects multiple reviewers for multiple domains", () => {
    const domains = {
      performance: true, migration: true, accessibility: true,
      compliance: false, observability: false, documentation: false,
      concurrency: false, i18n: true, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T2");
    assert.equal(selection.reviewers.length, 4);
    assert.ok(selection.tools.length >= 4);
  });

  it("generates meaningful summary", () => {
    const domains = {
      performance: true, migration: false, accessibility: false,
      compliance: false, observability: false, documentation: false,
      concurrency: false, i18n: false, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T2");
    assert.ok(selection.summary.includes("Performance Analyst"));
    assert.ok(selection.summary.includes("tools: 1"));
  });
});

describe("getActiveRejectionCodes", () => {
  it("returns codes from active reviewers", () => {
    const domains = {
      performance: true, migration: true, accessibility: false,
      compliance: false, observability: false, documentation: false,
      concurrency: false, i18n: false, infrastructure: false,
    };
    const selection = selectReviewers(domains, "T2");
    const codes = getActiveRejectionCodes(selection);
    assert.ok(codes.includes("perf-gap"));
    assert.ok(codes.includes("compat-break"));
  });
});

describe("listDomainReviewers", () => {
  it("returns all 10 reviewers", () => {
    const all = listDomainReviewers();
    assert.equal(all.length, 10);
  });
});

// ═══ 3. Trigger Integration ═══════════════════════════════════════════

describe("evaluateTrigger with domains", () => {
  it("returns activeDomains in result", () => {
    const result = evaluateTrigger({
      changedFiles: 2,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      domains: {
        performance: true, migration: false, accessibility: false,
        compliance: false, observability: false, documentation: true,
        concurrency: false, i18n: false, infrastructure: false,
      },
    });
    assert.ok(result.activeDomains.includes("performance"));
    assert.ok(result.activeDomains.includes("documentation"));
  });

  it("high-risk domains increase score", () => {
    const base = evaluateTrigger({
      changedFiles: 3,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });

    const withMigration = evaluateTrigger({
      changedFiles: 3,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      domains: {
        performance: false, migration: true, accessibility: false,
        compliance: false, observability: false, documentation: false,
        concurrency: false, i18n: false, infrastructure: false,
      },
    });

    assert.ok(withMigration.score > base.score, "migration domain should increase score");
    assert.ok(withMigration.reasons.some(r => r.includes("migration")));
  });

  it("low-risk domains do not increase score", () => {
    const base = evaluateTrigger({
      changedFiles: 2,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });

    const withDocs = evaluateTrigger({
      changedFiles: 2,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      domains: {
        performance: false, migration: false, accessibility: false,
        compliance: false, observability: false, documentation: true,
        concurrency: false, i18n: false, infrastructure: false,
      },
    });

    assert.equal(withDocs.score, base.score, "documentation domain should not increase score");
    assert.ok(withDocs.activeDomains.includes("documentation"));
  });

  it("multiple high-risk domains can escalate to T3", () => {
    const result = evaluateTrigger({
      changedFiles: 5,
      securitySensitive: true,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      domains: {
        performance: false, migration: true, accessibility: false,
        compliance: true, observability: false, documentation: false,
        concurrency: true, i18n: false, infrastructure: false,
      },
    });

    assert.equal(result.tier, "T3");
    assert.equal(result.mode, "deliberative");
  });

  it("works without domains (backward compatible)", () => {
    const result = evaluateTrigger({
      changedFiles: 1,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
    });
    assert.deepEqual(result.activeDomains, []);
    assert.equal(result.tier, "T1");
  });
});

// ═══ 4. Evidence Enrichment ═══════════════════════════════════════════

describe("enrichEvidence", () => {
  it("returns original evidence when no findings", () => {
    const original = "## Claim\nFixed the bug.";
    const result = enrichEvidence(original, [], []);
    assert.equal(result, original);
  });

  it("appends specialist section with tool results", () => {
    const original = "## Claim\nAdded index.";
    const toolResults = [{
      tool: "perf_scan",
      domain: "performance",
      status: "fail",
      output: "N+1 query detected in handler.ts:42",
      duration: 150,
    }];
    const result = enrichEvidence(original, toolResults, []);
    assert.ok(result.includes("## Specialist Reviews"));
    assert.ok(result.includes("perf_scan"));
    assert.ok(result.includes("N+1 query"));
    assert.ok(result.includes("❌"));
  });

  it("appends specialist opinions", () => {
    const original = "## Claim\nAdded aria labels.";
    const opinions = [{
      agent: "a11y-auditor",
      domain: "accessibility",
      verdict: "changes_requested",
      reasoning: "Missing alt text on image",
      codes: ["a11y-gap"],
      findings: [{ file: "src/Logo.tsx", line: 5, severity: "serious", issue: "img missing alt" }],
      confidence: 0.85,
    }];
    const result = enrichEvidence(original, [], opinions);
    assert.ok(result.includes("a11y-auditor"));
    assert.ok(result.includes("a11y-gap"));
    assert.ok(result.includes("img missing alt"));
  });

  it("includes both tools and opinions", () => {
    const toolResults = [{
      tool: "i18n_validate", domain: "i18n",
      status: "pass", output: "All keys match", duration: 50,
    }];
    const opinions = [{
      agent: "perf-analyst", domain: "performance",
      verdict: "approved", reasoning: "No issues",
      codes: [], findings: [], confidence: 0.9,
    }];
    const result = enrichEvidence("Evidence", toolResults, opinions);
    assert.ok(result.includes("Deterministic Tool Results"));
    assert.ok(result.includes("Specialist Agent Opinions"));
  });
});

describe("buildSpecialistSection", () => {
  it("shows pass icon for passing tools", () => {
    const section = buildSpecialistSection(
      [{ tool: "license_scan", domain: "compliance", status: "pass", output: "", duration: 30 }],
      [],
    );
    assert.ok(section.includes("✅"));
    assert.ok(section.includes("license_scan"));
  });

  it("shows fail details for failing tools", () => {
    const section = buildSpecialistSection(
      [{ tool: "compat_check", domain: "migration", status: "fail", output: "Breaking: removed export Foo", duration: 80 }],
      [],
    );
    assert.ok(section.includes("❌"));
    assert.ok(section.includes("Breaking: removed export Foo"));
  });

  it("limits findings to 10", () => {
    const findings = Array.from({ length: 15 }, (_, i) => ({
      file: `file${i}.ts`, severity: "medium", issue: `issue ${i}`,
    }));
    const section = buildSpecialistSection([], [{
      agent: "test", domain: "test", verdict: "changes_requested",
      reasoning: "many issues", codes: [], findings, confidence: 0.5,
    }]);
    // Should contain at most 10 finding lines (- prefix)
    const findingLines = section.split("\n").filter(l => l.startsWith("- **"));
    assert.ok(findingLines.length <= 10);
  });
});

// ═══ 5. End-to-End Flow ═══════════════════════════════════════════════

describe("end-to-end: detect → route → enrich", () => {
  it("full pipeline from files to enriched evidence", () => {
    // Step 1: Detect domains
    const detection = detectDomains(
      ["db/migrations/003_add_index.sql", "src/api/users.ts"],
      "ALTER TABLE users ADD INDEX idx_email (email); SELECT * FROM users WHERE email = ?",
    );
    assert.equal(detection.domains.migration, true);
    assert.equal(detection.domains.performance, true);

    // Step 2: Evaluate trigger with domains
    const trigger = evaluateTrigger({
      changedFiles: 2,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      domains: detection.domains,
    });
    assert.ok(trigger.activeDomains.includes("migration"));
    assert.ok(trigger.activeDomains.includes("performance"));

    // Step 3: Select reviewers
    const selection = selectReviewers(detection.domains, trigger.tier);
    assert.ok(selection.reviewers.length >= 2);
    assert.ok(selection.tools.includes("perf_scan"));
    assert.ok(selection.tools.includes("compat_check"));

    // Step 4: Enrich evidence (simulated tool results)
    const enriched = enrichEvidence(
      "## Claim\nAdded index for email lookup.",
      [
        { tool: "perf_scan", domain: "performance", status: "pass", output: "", duration: 100 },
        { tool: "compat_check", domain: "migration", status: "pass", output: "", duration: 80 },
      ],
      [],
    );
    assert.ok(enriched.includes("Specialist Reviews"));
    assert.ok(enriched.includes("perf_scan"));
    assert.ok(enriched.includes("compat_check"));
  });

  it("plain code changes skip specialist pipeline", () => {
    const detection = detectDomains(
      ["src/utils/math.ts"],
      "export function add(a: number, b: number) { return a + b; }",
    );
    assert.equal(detection.activeCount, 0);

    const selection = selectReviewers(detection.domains, "T2");
    assert.equal(selection.reviewers.length, 0);

    const enriched = enrichEvidence("## Claim\nAdded add function.", [], []);
    assert.ok(!enriched.includes("Specialist Reviews"));
  });

  it("documentation-only change stays at T1 with doc reviewer", () => {
    const detection = detectDomains(["README.md"]);
    assert.equal(detection.domains.documentation, true);
    assert.equal(detection.activeCount, 1);

    const trigger = evaluateTrigger({
      changedFiles: 1,
      securitySensitive: false,
      priorRejections: 0,
      apiSurfaceChanged: false,
      crossLayerChange: false,
      isRevert: false,
      domains: detection.domains,
    });
    // Low-risk domain → score not increased → stays T1
    assert.equal(trigger.tier, "T1");
    assert.ok(trigger.activeDomains.includes("documentation"));

    // Doc reviewer tool still selected (deterministic, zero cost)
    const selection = selectReviewers(detection.domains, trigger.tier);
    assert.ok(selection.tools.includes("doc_coverage"));
    // But no LLM agent at T1 (doc-steward requires T3)
    assert.equal(selection.agents.length, 0);
  });
});
