#!/usr/bin/env node
/**
 * GRAPH-4: PRD→Entity Bootstrap Tests
 *
 * Tests bootstrapFromPRD() and expandRefs():
 * - FR table parsing → requirement entities
 * - NFR table parsing → requirement entities (NFR prefix)
 * - Core Invariant parsing → criterion entities
 * - Depends On → depends_on relations
 * - Related FR → constrains relations
 * - Range expansion (FR-25~FR-27)
 * - Idempotency (skip existing entities)
 *
 * Run: node --test tests/graph-bootstrap.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { EventStore } = await import("../dist/platform/bus/store.js");
const { getEntity, listEntities } = await import("../dist/platform/bus/graph-schema.js");
const { getRelationsByType } = await import("../dist/platform/bus/graph-relations.js");
const { bootstrapFromPRD, expandRefs } = await import("../dist/platform/bus/graph-bootstrap.js");

// ── Test PRD content ────────────────────────

const TEST_PRD = `# PRD — Test Project

## Overview

Test PRD for bootstrap testing.

### Functional Requirements

| ID | Track | Requirement | Acceptance Criteria | Priority | Depends On |
|----|-------|-------------|-------------------|----------|------------|
| FR-01 | CORE | User login | Users can log in | P0 | — |
| FR-02 | CORE | User signup | Users can sign up | P0 | FR-01 |
| FR-03 | API | REST endpoints | API works | P1 | FR-01, FR-02 |
| FR-04 | UI | Dashboard | Dashboard renders | P2 | FR-01~FR-03 |

### Non-Functional Requirements

| ID | Track | Category | Requirement | Metric |
|----|-------|----------|-------------|--------|
| NFR-01 | CORE | Performance | Response under 200ms | p99 latency |
| NFR-02 | CORE | Security | No SQL injection | OWASP scan |

### Core Invariant

| Invariant | Related FR | Must Hold | Must Fail If |
|-----------|-----------|-----------|--------------|
| Auth required | FR-01, NFR-02 | All API calls authenticated | Unauthenticated access succeeds |
| Data integrity | FR-03 | Writes are transactional | Partial write persists |
`;

let store;
let db;
let tmpDir;
let prdPath;

beforeEach(() => {
  store = new EventStore(":memory:");
  db = store.db;
  tmpDir = mkdtempSync(join(tmpdir(), "graph-bootstrap-"));
  prdPath = join(tmpDir, "PRD.md");
  writeFileSync(prdPath, TEST_PRD);
});

afterEach(() => {
  store.close();
  try { unlinkSync(prdPath); } catch (_) {}
});

// ═══ 1. expandRefs ══════════════════════════════════════════════════════

describe("expandRefs", () => {
  it("handles single ref", () => {
    assert.deepEqual(expandRefs("FR-01"), ["FR-01"]);
  });

  it("handles comma-separated refs", () => {
    assert.deepEqual(expandRefs("FR-01, FR-02"), ["FR-01", "FR-02"]);
  });

  it("handles range with tilde", () => {
    assert.deepEqual(expandRefs("FR-01~FR-03"), ["FR-01", "FR-02", "FR-03"]);
  });

  it("handles mixed comma and range", () => {
    assert.deepEqual(expandRefs("FR-01, FR-03~FR-05"), ["FR-01", "FR-03", "FR-04", "FR-05"]);
  });

  it("handles dash placeholder", () => {
    assert.deepEqual(expandRefs("—"), []);
  });

  it("handles NFR prefix", () => {
    assert.deepEqual(expandRefs("NFR-8~NFR-9"), ["NFR-8", "NFR-9"]);
  });
});

// ═══ 2. FR parsing ══════════════════════════════════════════════════════

describe("bootstrapFromPRD — FR entities", () => {
  it("creates requirement entities from FR rows", () => {
    const result = bootstrapFromPRD(db, prdPath);
    assert.ok(result.entities >= 4);

    const fr01 = getEntity(db, "FR-01");
    assert.ok(fr01);
    assert.equal(fr01.type, "requirement");
    assert.equal(fr01.title, "User login");
    assert.equal(fr01.metadata.track, "CORE");
    assert.equal(fr01.metadata.priority, "P0");
    assert.equal(fr01.metadata.source, "prd-bootstrap");
  });

  it("creates all 4 FR entities", () => {
    bootstrapFromPRD(db, prdPath);
    for (const id of ["FR-01", "FR-02", "FR-03", "FR-04"]) {
      assert.ok(getEntity(db, id), `${id} should exist`);
    }
  });
});

// ═══ 3. NFR parsing ═════════════════════════════════════════════════════

describe("bootstrapFromPRD — NFR entities", () => {
  it("creates requirement entities from NFR rows", () => {
    bootstrapFromPRD(db, prdPath);

    const nfr01 = getEntity(db, "NFR-01");
    assert.ok(nfr01);
    assert.equal(nfr01.type, "requirement");
    assert.equal(nfr01.metadata.nfr, true);
    assert.equal(nfr01.metadata.category, "Performance");
  });

  it("creates all NFR entities", () => {
    bootstrapFromPRD(db, prdPath);
    assert.ok(getEntity(db, "NFR-01"));
    assert.ok(getEntity(db, "NFR-02"));
  });
});

// ═══ 4. Core Invariant parsing ═══════════════════════════════════════════

describe("bootstrapFromPRD — Core Invariant entities", () => {
  it("creates criterion entities from CI rows", () => {
    bootstrapFromPRD(db, prdPath);

    const ci01 = getEntity(db, "CI-01");
    assert.ok(ci01);
    assert.equal(ci01.type, "criterion");
    assert.equal(ci01.title, "Auth required");
    assert.ok(ci01.metadata.mustHold);
  });

  it("creates CI-02 for second invariant", () => {
    bootstrapFromPRD(db, prdPath);
    const ci02 = getEntity(db, "CI-02");
    assert.ok(ci02);
    assert.equal(ci02.title, "Data integrity");
  });
});

// ═══ 5. Relations — depends_on ═══════════════════════════════════════════

describe("bootstrapFromPRD — depends_on relations", () => {
  it("creates depends_on from FR-02 → FR-01", () => {
    bootstrapFromPRD(db, prdPath);
    const deps = getRelationsByType(db, "depends_on");
    const fr02dep = deps.find(r => r.fromId === "FR-02" && r.toId === "FR-01");
    assert.ok(fr02dep, "FR-02 should depend on FR-01");
  });

  it("creates multiple depends_on from FR-03", () => {
    bootstrapFromPRD(db, prdPath);
    const deps = getRelationsByType(db, "depends_on");
    const fr03deps = deps.filter(r => r.fromId === "FR-03");
    assert.equal(fr03deps.length, 2); // FR-01, FR-02
  });

  it("expands range depends_on from FR-04", () => {
    bootstrapFromPRD(db, prdPath);
    const deps = getRelationsByType(db, "depends_on");
    const fr04deps = deps.filter(r => r.fromId === "FR-04");
    assert.equal(fr04deps.length, 3); // FR-01, FR-02, FR-03
  });
});

// ═══ 6. Relations — constrains ═══════════════════════════════════════════

describe("bootstrapFromPRD — constrains relations", () => {
  it("creates constrains from CI-01 → FR-01", () => {
    bootstrapFromPRD(db, prdPath);
    const rels = getRelationsByType(db, "constrains");
    const ci01ToFr01 = rels.find(r => r.fromId === "CI-01" && r.toId === "FR-01");
    assert.ok(ci01ToFr01, "CI-01 should constrain FR-01");
  });

  it("creates constrains from CI-02 → FR-03", () => {
    bootstrapFromPRD(db, prdPath);
    const rels = getRelationsByType(db, "constrains");
    const ci02 = rels.find(r => r.fromId === "CI-02" && r.toId === "FR-03");
    assert.ok(ci02, "CI-02 should constrain FR-03");
  });
});

// ═══ 7. Idempotency ═════════════════════════════════════════════════════

describe("bootstrapFromPRD — idempotency", () => {
  it("skips existing entities on second run", () => {
    const first = bootstrapFromPRD(db, prdPath);
    const second = bootstrapFromPRD(db, prdPath);
    assert.equal(second.entities, 0);
    assert.equal(second.skipped, first.entities);
  });

  it("total entity count unchanged after second run", () => {
    bootstrapFromPRD(db, prdPath);
    const countBefore = listEntities(db).length;
    bootstrapFromPRD(db, prdPath);
    const countAfter = listEntities(db).length;
    assert.equal(countBefore, countAfter);
  });
});

// ═══ 8. Return value ════════════════════════════════════════════════════

describe("bootstrapFromPRD — return value", () => {
  it("returns correct entity count", () => {
    const result = bootstrapFromPRD(db, prdPath);
    // 4 FR + 2 NFR + 2 CI = 8
    assert.equal(result.entities, 8);
  });

  it("returns correct relation count", () => {
    const result = bootstrapFromPRD(db, prdPath);
    // FR-02→FR-01 (1) + FR-03→FR-01,FR-02 (2) + FR-04→FR-01,FR-02,FR-03 (3)
    // + CI-01→FR-01 (1) + CI-02→FR-03 (1)
    // CI-01→NFR-02 would need criterion→requirement which is allowed
    assert.ok(result.relations >= 7);
  });

  it("returns zero skipped on first run", () => {
    const result = bootstrapFromPRD(db, prdPath);
    assert.equal(result.skipped, 0);
  });
});
