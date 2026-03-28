#!/usr/bin/env node
/**
 * Blueprint Lint Tests — naming convention parsing and violation detection.
 *
 * Tests: Blueprint markdown parsing, alternative generation, violation patterns.
 *
 * Run: node --test tests/blueprint-lint.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const {
  extractNamingRules,
  generateAlternatives,
  parseBlueprints,
} = await import("../dist/platform/bus/blueprint-parser.js");

// ═══ 1. extractNamingRules ═══════════════════════════════════════

describe("extractNamingRules", () => {
  it("parses a Blueprint naming conventions table", () => {
    const markdown = `# Blueprint: OrderApp

## Naming Conventions

| Concept | Name | Rationale |
|---------|------|-----------|
| Restaurant list | Restaurants | Plural noun |
| Order status | OrderStatus | PascalCase enum |
| Create order | createOrder | camelCase function |
`;

    const rules = extractNamingRules(markdown);
    assert.equal(rules.length, 3);
    assert.equal(rules[0].concept, "Restaurant list");
    assert.equal(rules[0].name, "Restaurants");
    assert.equal(rules[0].rationale, "Plural noun");
    assert.equal(rules[1].name, "OrderStatus");
    assert.equal(rules[2].name, "createOrder");
  });

  it("handles backtick-wrapped names", () => {
    const markdown = `## Naming Conventions
| Concept | Name | Rationale |
|---------|------|-----------|
| API client | \`ApiClient\` | PascalCase |
`;

    const rules = extractNamingRules(markdown);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].name, "ApiClient");
  });

  it("returns empty for no naming section", () => {
    const rules = extractNamingRules("# Blueprint\n\nNo naming conventions here.");
    assert.equal(rules.length, 0);
  });

  it("ignores non-table content in naming section", () => {
    const markdown = `## Naming Conventions

Some intro text here.

| Concept | Name | Rationale |
|---------|------|-----------|
| User model | User | Domain entity |

Some trailing text.
`;
    const rules = extractNamingRules(markdown);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].name, "User");
  });
});

// ═══ 2. generateAlternatives ═════════════════════════════════════

describe("generateAlternatives", () => {
  it("generates PascalCase/camelCase/suffix alternatives for multi-word concepts", () => {
    const alts = generateAlternatives("Restaurant list", "Restaurants");
    assert.ok(alts.includes("RestaurantList"), "should include RestaurantList");
    assert.ok(alts.includes("restaurantList"), "should include restaurantList");
    assert.ok(!alts.includes("Restaurants"), "should not include mandated name");
  });

  it("generates suffix alternatives for single-word concepts", () => {
    const alts = generateAlternatives("Order", "Order");
    // Should include OrderList, OrderArray, etc.
    assert.ok(alts.some(a => a.endsWith("List")), "should have List suffix");
    assert.ok(alts.some(a => a.endsWith("Collection")), "should have Collection suffix");
  });

  it("removes duplicates", () => {
    const alts = generateAlternatives("Test case", "TestCase");
    const unique = new Set(alts);
    assert.equal(alts.length, unique.size);
  });
});

// ═══ 3. Violation detection (regex) ══════════════════════════════

describe("violation pattern matching", () => {
  it("creates regex that matches alternatives but not mandated name", () => {
    const markdown = `## Naming Conventions
| Concept | Name | Rationale |
|---------|------|-----------|
| Restaurant list | Restaurants | Plural noun |
`;
    const rules = extractNamingRules(markdown);
    const rule = rules[0];

    // "RestaurantList" is a violation
    assert.ok(rule.violationPattern.test("class RestaurantList {}"), "should match RestaurantList");
    // "Restaurants" is NOT a violation
    assert.ok(!rule.violationPattern.test("class Restaurants {}"), "should not match Restaurants");
  });

  it("detects multiple alternative patterns", () => {
    const markdown = `## Naming Conventions
| Concept | Name | Rationale |
|---------|------|-----------|
| Order service | OrderApi | Custom name |
`;
    const rules = extractNamingRules(markdown);
    const rule = rules[0];

    assert.ok(rule.violationPattern.test("class OrderService {}"), "should catch OrderService");
  });
});

// ═══ 4. parseBlueprints (directory scan) ═════════════════════════

describe("parseBlueprints", () => {
  const tmpDir = resolve(process.cwd(), ".test-blueprint-" + Date.now());

  it("returns empty for non-existent directory", () => {
    const result = parseBlueprints(resolve(tmpDir, "nonexistent"));
    assert.equal(result.rules.length, 0);
    assert.equal(result.sources.length, 0);
  });

  it("parses multiple Blueprint files in a directory", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(resolve(tmpDir, "blueprint-auth.md"), `## Naming Conventions
| Concept | Name | Rationale |
|---------|------|-----------|
| Auth service | AuthService | Domain service |
`, "utf8");
    writeFileSync(resolve(tmpDir, "blueprint-order.md"), `## Naming Conventions
| Concept | Name | Rationale |
|---------|------|-----------|
| Order model | OrderEntity | Domain entity |
`, "utf8");

    try {
      const result = parseBlueprints(tmpDir);
      assert.equal(result.rules.length, 2);
      assert.ok(result.sources.length >= 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ═══ 5. Tool integration ═════════════════════════════════════════

describe("toolBlueprintLint", () => {
  it("returns no-rules message for empty design dir", async () => {
    const { toolBlueprintLint } = await import("../platform/core/tools/tool-core.mjs");
    const result = toolBlueprintLint({ design_dir: "/nonexistent/path" });
    assert.ok(result.text.includes("No naming conventions found"));
    assert.equal(result.json.total, 0);
  });
});
